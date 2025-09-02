import os
from dotenv import load_dotenv

# Load environment variables from a .env file located in the project root.
load_dotenv()

# --- Database Configuration ---
# Fetches database credentials from environment variables, using keys from the provided .env file.
AP_POSTGRES_URL: str = os.environ.get("AP_POSTGRES_URL","")

DB_NAME: str = os.environ.get("AP_POSTGRES_DATABASE", "activepieces")
DB_USER: str = os.environ.get("AP_POSTGRES_USERNAME", "postgres")
DB_PASSWORD: str = os.environ.get("AP_POSTGRES_PASSWORD", "abcd")
DB_HOST: str = os.environ.get("AP_POSTGRES_HOST", "postgres")
DB_PORT: str = os.environ.get("AP_POSTGRES_PORT", "5432")

# --- Activepieces API Configuration ---
# The base URL for the Activepieces instance you are proxying.
AP_BASE: str = os.environ.get("AP_BASE", "http://localhost:80")

# --- Application Configuration ---
# The timeout for requests made to the Activepieces API.
TIMEOUT: int = int(os.environ.get("TIMEOUT", 15))

# CORS origins are loaded from the AP_SALESOPTAIURL variable in the .env file.
# This can be a single URL or a comma-separated list of URLs.
CORS_ORIGINS_STR: str = os.environ.get("AP_SALESOPTAIURL", "http://localhost:3000")
CORS_ORIGINS: list = [origin.strip() for origin in CORS_ORIGINS_STR.split(',')]
#frontend url
AP_FRONTEND_URL:str=os.environ.get("AP_FRONTEND_URL", "http://localhost:5000")
AP_PROXY_URL:str=os.environ.get("AP_PROXY_URL", "http://localhost:5000")
