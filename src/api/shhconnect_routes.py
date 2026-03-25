import asyncio
import io
from typing import Dict, Any, Optional
from uuid import uuid4

import paramiko
import pyodbc
from sshtunnel import SSHTunnelForwarder
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

SSH_TUNNELS: Dict[str, SSHTunnelForwarder] = {}
SQL_CONNECTIONS: Dict[str, pyodbc.Connection] = {}


class SSHConnectRequest(BaseModel):
    ssh_host: str
    ssh_port: int = 22
    ssh_user: str
    private_key: str
    remote_bind_host: str
    remote_bind_port: int
    private_key_passphrase: Optional[str] = None


class SQLConnectRequest(BaseModel):
    tunnel_id: str
    db_name: str
    db_user: str
    db_password: str
    driver: str = "ODBC Driver 18 for SQL Server"
    trust_server_certificate: bool = True


class SQLQueryRequest(BaseModel):
    connection_id: str
    query: str


def load_private_key(private_key_str: str, passphrase: Optional[str] = None):
    key_io = io.StringIO(private_key_str)

    loaders = [
        paramiko.RSAKey.from_private_key,
        paramiko.Ed25519Key.from_private_key,
        paramiko.ECDSAKey.from_private_key,
    ]

    for loader in loaders:
        key_io.seek(0)
        try:
            return loader(key_io, password=passphrase)
        except Exception:
            pass

    raise HTTPException(status_code=400, detail="Invalid SSH private key")


@router.post("/ssh/connect")
async def ssh_connect(payload: SSHConnectRequest):
    try:
        pkey = load_private_key(payload.private_key, payload.private_key_passphrase)

        tunnel = SSHTunnelForwarder(
            (payload.ssh_host, payload.ssh_port),
            ssh_username=payload.ssh_user,
            ssh_pkey=pkey,
            remote_bind_address=(payload.remote_bind_host, payload.remote_bind_port),
        )
        tunnel.start()

        tunnel_id = str(uuid4())
        SSH_TUNNELS[tunnel_id] = tunnel

        return {
            "success": True,
            "tunnel_id": tunnel_id,
            "local_host": "127.0.0.1",
            "local_port": tunnel.local_bind_port,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SSH connection failed: {str(e)}")


@router.post("/sql/connect")
async def sql_connect(payload: SQLConnectRequest):
    tunnel = SSH_TUNNELS.get(payload.tunnel_id)
    if not tunnel or not tunnel.is_active:
        raise HTTPException(status_code=404, detail="SSH tunnel not found or inactive")

    try:
        conn_str = (
            f"DRIVER={{{payload.driver}}};"
            f"SERVER=127.0.0.1,{tunnel.local_bind_port};"
            f"DATABASE={payload.db_name};"
            f"UID={payload.db_user};"
            f"PWD={payload.db_password};"
            f"TrustServerCertificate={'yes' if payload.trust_server_certificate else 'no'};"
        )

        conn = await asyncio.to_thread(pyodbc.connect, conn_str)
        connection_id = str(uuid4())
        SQL_CONNECTIONS[connection_id] = conn

        return {
            "success": True,
            "connection_id": connection_id,
            "message": "SQL connection established",
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SQL connection failed: {str(e)}")


@router.post("/sql/query")
async def sql_query(payload: SQLQueryRequest):
    conn = SQL_CONNECTIONS.get(payload.connection_id)
    if not conn:
        raise HTTPException(status_code=404, detail="SQL connection not found")

    def run_query():
        cursor = conn.cursor()
        try:
            cursor.execute(payload.query)

            if cursor.description:
                columns = [col[0] for col in cursor.description]
                rows = cursor.fetchall()
                data = [dict(zip(columns, row)) for row in rows]
                return {"success": True, "data": data}

            conn.commit()
            return {"success": True, "rows_affected": cursor.rowcount}
        finally:
            cursor.close()

    try:
        return await asyncio.to_thread(run_query)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SQL query failed: {str(e)}")


@router.delete("/sql/disconnect/{connection_id}")
async def sql_disconnect(connection_id: str):
    conn = SQL_CONNECTIONS.pop(connection_id, None)
    if not conn:
        raise HTTPException(status_code=404, detail="SQL connection not found")

    try:
        conn.close()
        return {"success": True, "message": "SQL connection closed"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to close SQL connection: {str(e)}")


@router.delete("/ssh/disconnect/{tunnel_id}")
async def ssh_disconnect(tunnel_id: str):
    tunnel = SSH_TUNNELS.pop(tunnel_id, None)
    if not tunnel:
        raise HTTPException(status_code=404, detail="SSH tunnel not found")

    try:
        tunnel.stop()
        return {"success": True, "message": "SSH tunnel closed"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to close SSH tunnel: {str(e)}")
