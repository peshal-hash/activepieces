from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .api import proxy_routes # Import your routes
from .database import ActivepiecesDatabase
from .core import config
from .database_management import db_manager


app = FastAPI()

# --- CORS Middleware ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Include the router from the api directory
app.include_router(proxy_routes.router)

@app.on_event("startup")
async def startup_event():
    db_manager.ensure_database_exists()
    db_manager.setup_database()
    print("Database setup complete.")
