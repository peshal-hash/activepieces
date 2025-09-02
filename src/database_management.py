"""
This file holds the shared instance of the ActivepiecesDatabase.
By creating the instance here, we avoid circular dependencies between
main.py and the API route modules that also need access to the database.
"""
from .database import ActivepiecesDatabase

# Initialize the database manager instance that will be shared across the application.
db_manager = ActivepiecesDatabase()
