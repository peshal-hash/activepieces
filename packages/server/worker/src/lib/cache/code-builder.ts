import fs, { rm } from 'node:fs/promises'
import path from 'node:path'
import { cryptoUtils, fileSystemUtils } from '@activepieces/server-shared'
import { ExecutionMode, FlowVersionState, SourceCode, tryCatch } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { workerMachine } from '../utils/machine'
import { cacheState, NO_SAVE_GUARD } from './cache-state'
import { packageManager } from './package-manager'

// Node.js built-in modules that should NOT be added as npm dependencies
const NODE_BUILTIN_MODULES = new Set([
    'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
    'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain',
    'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net',
    'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring',
    'readline', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls',
    'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
])

/**
 * Extracts npm package names from import/require statements in TypeScript/JavaScript code.
 * Filters out relative imports, absolute paths, and Node.js built-in modules.
 */
function extractPackageImports(code: string): string[] {
    const importRegex = /(?:^|\n)\s*import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g
    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
    const packages = new Set<string>()

    const collectPkg = (specifier: string) => {
        // Skip relative/absolute paths and node: protocol aliases
        if (specifier.startsWith('.') || specifier.startsWith('/')) return
        const withoutNodeProtocol = specifier.startsWith('node:') ? specifier.slice(5) : specifier
        const rootPkg = specifier.startsWith('@')
            ? specifier.split('/').slice(0, 2).join('/')
            : specifier.split('/')[0]
        const rootPkgNoProtocol = withoutNodeProtocol.split('/')[0]
        if (!NODE_BUILTIN_MODULES.has(rootPkgNoProtocol)) {
            packages.add(rootPkg)
        }
    }

    let m: RegExpExecArray | null
    while ((m = importRegex.exec(code)) !== null) collectPkg(m[1])
    while ((m = requireRegex.exec(code)) !== null) collectPkg(m[1])

    return Array.from(packages)
}

const TS_CONFIG_CONTENT = `

{
    "compilerOptions": {
        "lib": ["es2022", "dom"],
        "module": "commonjs", 
        "target": "es2022",
        "esModuleInterop": true,
        "skipLibCheck": true,
        "forceConsistentCasingInFileNames": true,
        "noUnusedLocals": false,
        "noUnusedParameters": false,
        "strict": false,
        "strictPropertyInitialization": false,
        "strictNullChecks": false,
        "strictFunctionTypes": false,
        "strictBindCallApply": false,
        "noImplicitAny": false,
        "noImplicitThis": false,
        "noImplicitReturns": false,
        "noFallthroughCasesInSwitch": false
    }
}
`

const INVALID_ARTIFACT_TEMPLATE = `
    exports.code = async (params) => {
      throw new Error(\`\${ERROR_MESSAGE}\`);
    };
    `

const INVALID_ARTIFACT_ERROR_PLACEHOLDER = '${ERROR_MESSAGE}'

export const codeBuilder = (log: FastifyBaseLogger) => ({
    getCodesFolder({
        codesFolderPath,
        flowVersionId,
    }: {
        codesFolderPath: string
        flowVersionId: string
    }): string {
        return path.join(codesFolderPath, flowVersionId)
    },
    async processCodeStep({
        artifact,
        codesFolderPath,
    }: ProcessCodeStepParams): Promise<void> {
        const { sourceCode, flowVersionId, name } = artifact
        const flowVersionPath = this.getCodesFolder({
            codesFolderPath,
            flowVersionId,
        })
        const codePath = path.join(flowVersionPath, name)
        log.debug({
            message: 'CodeBuilder#processCodeStep',
            sourceCode,
            name,
            codePath,
        })

        const currentHash = await cryptoUtils.hashObject(sourceCode)
        const cache = cacheState(codePath, log)
        await cache.getOrSetCache({
            key: codePath,
            cacheMiss: (value: string) => {
                return value !== currentHash
            },
            installFn: async () => {
                const { code, packageJson } = sourceCode

                const codeNeedCleanUp = await fileSystemUtils.fileExists(codePath)
                if (codeNeedCleanUp) {
                    await rm(codePath, { recursive: true })
                }

                await fileSystemUtils.threadSafeMkdir(codePath)

                const startTime = performance.now()
                await installDependencies({
                    path: codePath,
                    packageJson: await getPackageJson(packageJson, code),
                    log,
                })
                log.info({
                    message: '[CodeBuilder#processCodeStep] Installed dependencies',
                    path: codePath,
                    timeTaken: `${Math.floor(performance.now() - startTime)}ms`,
                })

                const startTimeCompilation = performance.now()
                const { error } = await tryCatch(() => compileCode({
                    path: codePath,
                    code,
                    log,
                }))
                if (error) {
                    log.info({ codePath, error }, '[CodeBuilder#processCodeStep] Compilation error')
                    await handleCompilationError({ codePath, error })
                }
                else {
                    log.info({ codePath, timeTaken: `${Math.floor(performance.now() - startTimeCompilation)}ms` }, '[CodeBuilder#processCodeStep] Compilation success')
                }
                return currentHash
            },
            skipSave: NO_SAVE_GUARD,
        })
    },
})


function isPackagesAllowed(): boolean {
    switch (workerMachine.getSettings().EXECUTION_MODE) {
        case ExecutionMode.SANDBOX_CODE_ONLY:
            return false
        case ExecutionMode.SANDBOX_CODE_AND_PROCESS:
        case ExecutionMode.UNSANDBOXED:
        case ExecutionMode.SANDBOX_PROCESS:
            return true
        default:
            return false
    }
}


async function getPackageJson(packageJson: string, code: string): Promise<string> {
    const packagedAllowed = isPackagesAllowed()
    if (!packagedAllowed) {
        return '{"dependencies":{}}'
    }
    const { data: parsedPackageJson, error: parseError } = await tryCatch(() => JSON.parse(packageJson))
    const packageJsonObject = parseError ? {} : (parsedPackageJson as Record<string, unknown>)
    const existingDeps = (packageJsonObject?.['dependencies'] ?? {}) as Record<string, string>

    // Auto-detect packages imported in the code that are not yet listed in package.json.
    // This prevents bun build from failing when the user omits packages from the UI panel.
    const detectedImports = extractPackageImports(code)
    const autoDeps: Record<string, string> = {}
    for (const pkg of detectedImports) {
        if (!existingDeps[pkg] && pkg !== '@types/node') {
            autoDeps[pkg] = '*'
        }
    }

    return JSON.stringify({
        ...packageJsonObject,
        dependencies: {
            '@types/node': '18.17.1',
            ...existingDeps,
            ...autoDeps,
        },
    })
}

const installDependencies = async ({ path, packageJson, log }: InstallDependenciesParams): Promise<void> => {
    await fs.writeFile(`${path}/package.json`, packageJson, 'utf8')
    const deps = Object.entries(JSON.parse(packageJson).dependencies ?? {})
    if (deps.length > 0) {
        await packageManager(log).install({ path, filtersPath: [] })
    }
}

const compileCode = async ({
    path,
    code,
    log,
}: CompileCodeParams): Promise<void> => {
    await fs.writeFile(`${path}/tsconfig.json`, TS_CONFIG_CONTENT, {
        encoding: 'utf8',
        flag: 'w',
    })
    await fs.writeFile(`${path}/index.ts`, code, { encoding: 'utf8', flag: 'w' })

    await packageManager(log).build({
        path,
        entryFile: `${path}/index.ts`,
        outputFile: `${path}/index.js`,
    })
}

const handleCompilationError = async ({
    codePath,
    error,
}: HandleCompilationErrorParams): Promise<void> => {
    const isErrObj = typeof error === 'object' && error !== null
    const errorRecord = isErrObj ? error as Record<string, unknown> : null
    const stdoutError = errorRecord && 'stdout' in errorRecord ? String(errorRecord['stdout'] ?? '') : ''
    const stderrError = errorRecord && 'stderr' in errorRecord ? String(errorRecord['stderr'] ?? '') : ''
    const genericError = `${error ?? 'error compiling'}`
    // bun build writes errors to stderr; fall back to stdout then generic message
    const detail = stderrError || stdoutError || genericError
    const errorMessage = `Compilation Error \n${detail}`

    const invalidArtifactContent = INVALID_ARTIFACT_TEMPLATE.replace(
        INVALID_ARTIFACT_ERROR_PLACEHOLDER,
        errorMessage,
    )

    await fs.writeFile(`${codePath}/index.js`, invalidArtifactContent, 'utf8')
}

type ProcessCodeStepParams = {
    artifact: CodeArtifact
    codesFolderPath: string
    log: FastifyBaseLogger
}

export type CodeArtifact = {
    name: string
    sourceCode: SourceCode
    flowVersionId: string
    flowVersionState: FlowVersionState
}


type InstallDependenciesParams = {
    path: string
    packageJson: string
    log: FastifyBaseLogger
}

type CompileCodeParams = {
    path: string
    code: string
    log: FastifyBaseLogger
}

type HandleCompilationErrorParams = {
    codePath: string
    error: unknown
}
