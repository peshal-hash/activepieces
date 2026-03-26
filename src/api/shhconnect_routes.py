import asyncio
import io
import logging
import socket
from datetime import date, datetime, time
from decimal import Decimal
from typing import Any, Dict, Optional
from uuid import uuid4

import paramiko

# Compat shim: paramiko >= 3.0 removed DSSKey; sshtunnel still references it at runtime.
if not hasattr(paramiko, "DSSKey"):
    paramiko.DSSKey = type(
        "DSSKey",
        (paramiko.PKey,),
        {
            "get_name": lambda self: "ssh-dss",
            "sign_ssh_data": lambda self, msg: b"",
            "verify_ssh_sig": lambda self, msg, sig: False,
            "_from_private_key": classmethod(lambda cls, file_obj, password: None),
            "_from_public_key": classmethod(lambda cls, msg: None),
        },
    )

import pyodbc
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sshtunnel import SSHTunnelForwarder

router = APIRouter(prefix="/db-proxy", tags=["db-proxy"])
logger = logging.getLogger("db_proxy")

SSH_TUNNELS: Dict[str, SSHTunnelForwarder] = {}
SQL_CONNECTIONS: Dict[str, pyodbc.Connection] = {}
SQL_CONNECTION_TUNNELS: Dict[str, str] = {}


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
    encrypt: bool = True
    connection_timeout: int = Field(default=30, ge=1, le=300)


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


def _mask_conn_str(conn_str: str) -> str:
    parts = []
    for part in conn_str.split(";"):
        if part.upper().startswith("PWD="):
            parts.append("PWD=***")
        else:
            parts.append(part)
    return ";".join(parts)


def _check_local_port(host: str, port: int, timeout: int = 5) -> bool:
    with socket.create_connection((host, port), timeout=timeout):
        return True


def _serialize_value(value: Any) -> Any:
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()

    if isinstance(value, Decimal):
        # Use float for easier JSON handling
        return float(value)

    if isinstance(value, bytes):
        try:
            return value.decode("utf-8")
        except Exception:
            return value.hex()

    return value


def _build_conn_str(payload: SQLConnectRequest, local_port: int) -> str:
    return (
        f"DRIVER={{{payload.driver}}};"
        f"SERVER=tcp:127.0.0.1,{local_port};"
        f"DATABASE={payload.db_name};"
        f"UID={payload.db_user};"
        f"PWD={payload.db_password};"
        f"Encrypt={'yes' if payload.encrypt else 'no'};"
        f"TrustServerCertificate={'yes' if payload.trust_server_certificate else 'no'};"
        f"Connection Timeout={payload.connection_timeout};"
    )


@router.post("/ssh/connect")
async def ssh_connect(payload: SSHConnectRequest):
    pkey = load_private_key(payload.private_key, payload.private_key_passphrase)

    try:
        tunnel = SSHTunnelForwarder(
            (payload.ssh_host, payload.ssh_port),
            ssh_username=payload.ssh_user,
            ssh_pkey=pkey,
            remote_bind_address=(payload.remote_bind_host, payload.remote_bind_port),
        )

        await asyncio.to_thread(tunnel.start)

        if not tunnel.is_active:
            raise RuntimeError("SSH tunnel was created but did not become active")

        tunnel_id = str(uuid4())
        SSH_TUNNELS[tunnel_id] = tunnel

        logger.info(
            "SSH tunnel established tunnel_id=%s local_port=%s remote=%s:%s",
            tunnel_id,
            tunnel.local_bind_port,
            payload.remote_bind_host,
            payload.remote_bind_port,
        )

        return {
            "success": True,
            "tunnel_id": tunnel_id,
            "local_host": "127.0.0.1",
            "local_port": tunnel.local_bind_port,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("SSH connection failed")
        raise HTTPException(status_code=500, detail=f"SSH connection failed: {repr(e)}")


@router.post("/sql/connect")
async def sql_connect(payload: SQLConnectRequest):
    tunnel = SSH_TUNNELS.get(payload.tunnel_id)
    if not tunnel or not tunnel.is_active:
        raise HTTPException(status_code=404, detail="SSH tunnel not found or inactive")

    local_port = int(tunnel.local_bind_port)
    available_drivers = pyodbc.drivers()

    try:
        # Make sure the local forwarded port is reachable before trying ODBC
        await asyncio.to_thread(_check_local_port, "127.0.0.1", local_port, 5)
    except Exception as e:
        logger.exception("Forwarded SQL port is not reachable")
        raise HTTPException(
            status_code=500,
            detail=(
                f"Tunnel is active but forwarded SQL port is not reachable at "
                f"127.0.0.1:{local_port}: {repr(e)}"
            ),
        )

    if payload.driver not in available_drivers:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Requested ODBC driver '{payload.driver}' not found. "
                f"Available drivers: {available_drivers}"
            ),
        )

    conn_str = _build_conn_str(payload, local_port)

    try:
        logger.info("Attempting SQL connect using drivers=%s", available_drivers)
        logger.info("ODBC connection string: %s", _mask_conn_str(conn_str))

        conn = await asyncio.to_thread(pyodbc.connect, conn_str)

        connection_id = str(uuid4())
        SQL_CONNECTIONS[connection_id] = conn
        SQL_CONNECTION_TUNNELS[connection_id] = payload.tunnel_id

        logger.info(
            "SQL connection established connection_id=%s tunnel_id=%s",
            connection_id,
            payload.tunnel_id,
        )

        return {
            "success": True,
            "connection_id": connection_id,
            "message": "SQL connection established",
        }

    except pyodbc.Error as e:
        logger.exception("pyodbc connection failed")
        raise HTTPException(
            status_code=500,
            detail=(
                f"SQL connection failed: {repr(e)} | "
                f"requested_driver={payload.driver} | "
                f"available_drivers={available_drivers}"
            ),
        )
    except Exception as e:
        logger.exception("Unexpected SQL connection failure")
        raise HTTPException(status_code=500, detail=f"SQL connection failed: {repr(e)}")


@router.post("/sql/query")
async def sql_query(payload: SQLQueryRequest):
    conn = SQL_CONNECTIONS.get(payload.connection_id)
    if not conn:
        raise HTTPException(status_code=404, detail="SQL connection not found")

    query = payload.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Query cannot be empty")

    def run_query():
        cursor = conn.cursor()
        try:
            cursor.execute(query)

            if cursor.description:
                columns = [col[0] for col in cursor.description]
                rows = cursor.fetchall()

                data = []
                for row in rows:
                    row_dict = {
                        columns[idx]: _serialize_value(value)
                        for idx, value in enumerate(row)
                    }
                    data.append(row_dict)

                return {"success": True, "data": data, "row_count": len(data)}

            conn.commit()
            return {"success": True, "rows_affected": cursor.rowcount}

        finally:
            cursor.close()

    try:
        return await asyncio.to_thread(run_query)
    except pyodbc.Error as e:
        logger.exception("SQL query failed")
        raise HTTPException(status_code=500, detail=f"SQL query failed: {repr(e)}")
    except Exception as e:
        logger.exception("Unexpected SQL query failure")
        raise HTTPException(status_code=500, detail=f"SQL query failed: {repr(e)}")


@router.delete("/sql/disconnect/{connection_id}")
async def sql_disconnect(connection_id: str):
    conn = SQL_CONNECTIONS.pop(connection_id, None)
    SQL_CONNECTION_TUNNELS.pop(connection_id, None)

    if not conn:
        raise HTTPException(status_code=404, detail="SQL connection not found")

    try:
        await asyncio.to_thread(conn.close)
        logger.info("SQL connection closed connection_id=%s", connection_id)
        return {"success": True, "message": "SQL connection closed"}
    except Exception as e:
        logger.exception("Failed to close SQL connection")
        raise HTTPException(
            status_code=500, detail=f"Failed to close SQL connection: {repr(e)}"
        )


@router.delete("/ssh/disconnect/{tunnel_id}")
async def ssh_disconnect(tunnel_id: str):
    tunnel = SSH_TUNNELS.pop(tunnel_id, None)
    if not tunnel:
        raise HTTPException(status_code=404, detail="SSH tunnel not found")

    # Close SQL connections that were created through this tunnel
    related_connection_ids = [
        connection_id
        for connection_id, linked_tunnel_id in SQL_CONNECTION_TUNNELS.items()
        if linked_tunnel_id == tunnel_id
    ]

    close_errors = []

    for connection_id in related_connection_ids:
        conn = SQL_CONNECTIONS.pop(connection_id, None)
        SQL_CONNECTION_TUNNELS.pop(connection_id, None)

        if conn:
            try:
                await asyncio.to_thread(conn.close)
            except Exception as e:
                logger.exception(
                    "Failed to close SQL connection during tunnel shutdown connection_id=%s",
                    connection_id,
                )
                close_errors.append(
                    f"connection_id={connection_id}, error={repr(e)}"
                )

    try:
        await asyncio.to_thread(tunnel.stop)
        logger.info("SSH tunnel closed tunnel_id=%s", tunnel_id)

        response = {"success": True, "message": "SSH tunnel closed"}
        if close_errors:
            response["warning"] = (
                "Tunnel closed, but some linked SQL connections failed to close cleanly"
            )
            response["close_errors"] = close_errors

        return response

    except Exception as e:
        logger.exception("Failed to close SSH tunnel")
        raise HTTPException(
            status_code=500, detail=f"Failed to close SSH tunnel: {repr(e)}"
        )
