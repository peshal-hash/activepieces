import os
import requests
from ..core import config
# --- Configuration ---
# This service is responsible for knowing the details of the Activepieces API.


def sign_up(email: str, password: str, first_name: str, last_name: str) -> dict:
    """
    Sends a sign-up request to the Activepieces API.

    Args:
        email: The user's email.
        password: The user's password.
        first_name: The user's first name.
        last_name: The user's last name.

    Returns:
        A dictionary containing the API response data.

    Raises:
        requests.exceptions.HTTPError: If the API returns an error status code.
    """

    url = f"{config.AP_BASE}/api/v1/authentication/sign-up"
    payload = {
        "email": email,
        "password": password,
        "firstName": first_name,
        "lastName": last_name,
        "trackEvents": True,
        "newsLetter": False,
    }
    response = requests.post(url, json=payload, timeout=config.TIMEOUT)
    response.raise_for_status()  # Raise an exception for 4xx or 5xx status codes
    return response.json()


def sign_in(email: str, password: str) -> dict:
    """
    Sends a sign-in request to the Activepieces API.

    Args:
        email: The user's email.
        password: The user's password.

    Returns:
        A dictionary containing the API response data.

    Raises:
        requests.exceptions.HTTPError: If the API returns an error status code.
    """
    url = f"{config.AP_BASE}/api/v1/authentication/sign-in"
    payload = {"email": email, "password": password}
    response = requests.post(url, json=payload, timeout=config.TIMEOUT)
    response.raise_for_status()
    return response.json()
