import psycopg2
import os
from urllib.parse import urlparse
from .core import config

class ActivepiecesDatabase:
    """Manages all database operations for the Activepieces proxy."""

    def __init__(self):
        """Initializes the database connection parameters from environment variables."""
        # ✨ MODIFIED: Prioritize connection URL, otherwise use individual variables.
        db_url = config.AP_POSTGRES_URL
        if db_url:
            # If a URL is provided, parse it into connection parameters
            result = urlparse(db_url)
            self.db_name = result.path.lstrip('/')
            self.conn_params = {
                'dbname': self.db_name,
                'user': result.username,
                'password': result.password,
                'host': result.hostname,
                'port': result.port
            }
        else:
            # Fallback to individual environment variables
            self.db_name = config.DB_NAME
            self.conn_params = {
                'dbname': config.DB_NAME,
                'user': config.DB_USER,
                'password': config.DB_PASSWORD,
                'host': config.DB_HOST,
                'port': config.DB_PORT
            }

    def _get_connection(self, dbname=None):
        """Establishes a connection to the specified database."""
        # ✨ MODIFIED: Use a single, flexible connection method.
        params = self.conn_params.copy()
        if dbname:
            params['dbname'] = dbname
        return psycopg2.connect(**params)

    def ensure_database_exists(self):
        """Ensures the application-specific database exists in PostgreSQL."""
        # This method now connects to the default 'postgres' db on the correct server
        conn = self._get_connection(dbname="postgres")
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM pg_database WHERE datname=%s", (self.db_name,))
            if cur.fetchone() is None:
                cur.execute(f'CREATE DATABASE "{self.db_name}"')
        conn.close()

    def get_db_connection(self):
        """Establishes a connection to the application database, creating it if it doesn't exist."""
        try:
            # Connect using the main application database name
            return self._get_connection()
        except psycopg2.OperationalError:
            self.ensure_database_exists()
            # Retry connection after ensuring the database exists
            return self._get_connection()

    def setup_database(self):
        """Creates the UserInfo table if it doesn't already exist."""
        conn = self.get_db_connection()
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS UserInfo (
                    user_id TEXT PRIMARY KEY,
                    email TEXT UNIQUE NOT NULL,
                    first_name TEXT,
                    last_name TEXT,
                    auth_token TEXT NOT NULL,
                    project_id TEXT NOT NULL,
                    platform_id TEXT NOT NULL
                )
            """)
        conn.commit()
        conn.close()

    def store_user_data(self, user_data: dict):
        """Inserts a new user or updates an existing user's data based on email."""
        conn = self.get_db_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT email FROM UserInfo WHERE email = %s", (user_data["email"],))
                user_exists = cur.fetchone()

                if user_exists:
                    cur.execute("""
                        UPDATE UserInfo
                        SET user_id = %s, first_name = %s, last_name = %s, auth_token = %s, project_id = %s, platform_id = %s
                        WHERE email = %s
                    """, (user_data["id"], user_data.get("firstName"), user_data.get("lastName"), user_data["token"], user_data["projectId"], user_data["platformId"], user_data["email"]))
                else:
                    cur.execute("""
                        INSERT INTO UserInfo (user_id, email, first_name, last_name, auth_token, project_id, platform_id)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """, (user_data["id"], user_data["email"], user_data.get("firstName"), user_data.get("lastName"), user_data["token"], user_data["projectId"], user_data["platformId"]))
            conn.commit()
        except Exception as e:
            conn.rollback()
            print(f"Database operation failed: {e}")
            raise
        finally:
            conn.close()
