import uvicorn
from src.main import app

if __name__ == "__main__":
    # The string "src.main:app" tells uvicorn where to find the FastAPI instance.
    # Uvicorn will handle reloading when you make changes to any file.
    uvicorn.run("src.main:app", host="0.0.0.0", port=5000, reload=True)
