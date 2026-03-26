from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .api import proxy_routes, shhconnect_routes
from .database import ActivepiecesDatabase
from .core import config
from .database_management import db_manager

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# include SSH/DB router FIRST
app.include_router(shhconnect_routes.router)

# include catch-all proxy router AFTER
app.include_router(proxy_routes.router)

@app.on_event("startup")
async def startup_event():
    db_manager.ensure_database_exists()
    db_manager.setup_database()
    print("Database setup complete.")
