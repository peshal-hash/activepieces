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

    url = f"{config.AP_BASE_URL}/api/v1/authentication/sign-up"
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
    url = f"{config.AP_BASE_URL}/api/v1/authentication/sign-in"
    payload = {"email": email, "password": password}
    response = requests.post(url, json=payload, timeout=config.TIMEOUT)
    response.raise_for_status()
    return response.json()


import requests
from typing import List, Dict
from ..core import config  # adjust import

BASE = config.AP_BASE_URL.rstrip('/')
USE_API_PREFIX = True  # set False if you hit Fastify directly
API = f"{BASE}/api" if USE_API_PREFIX else BASE

def list_projects(service_token: str, limit: int = 50) -> List[Dict]:
    url = f"{API}/v1/projects"
    headers = {"Authorization": f"Bearer {service_token}", "Accept": "application/json"}

    projects: List[Dict] = []
    seen_ids = set()
    cursor = None

    while True:
        params = {"limit": limit}
        if cursor:
            params["cursor"] = cursor

        resp = requests.get(url, headers=headers, params=params, timeout=10)
        resp.raise_for_status()
        page = resp.json()

        data = page.get("data", [])
        for proj in data:
            pid = proj.get("id")
            if pid and pid not in seen_ids:
                seen_ids.add(pid)
                projects.append(proj)

        next_cursor = page.get("next")
        if not next_cursor or next_cursor == cursor:
            break
        cursor = next_cursor

    return projects

def delete_project(project_id: str, service_token: str) -> None:
    url = f"{API}/v1/projects/{project_id}"
    headers = {"Authorization": f"Bearer {service_token}", "Accept": "application/json"}

    print(f"[delete_project] DELETE {url}")
    r = requests.delete(url, headers=headers, timeout=10)
    print(f"[delete_project] status={r.status_code} body={r.text!r}")

    # Only treat 204 as success
    if r.status_code == 204:
        return

    # If project truly didn't exist, that's weird but OK – log loudly
    if r.status_code == 404:
        raise RuntimeError(
            f"[delete_project] 404 when deleting project {project_id}. "
            f"Response: {r.text}"
        )

    # 400 ACTIVE_PROJECT is the special case from Activepieces
    if r.status_code == 400 and "ACTIVE_PROJECT" in r.text:
        raise RuntimeError(f"Cannot delete active project {project_id} with this token")

    # Anything else: blow up so we see it
    r.raise_for_status()



def delete_user(user_id: str, service_token: str) -> None:
    url = f"{API}/v1/users/{user_id}"
    headers = {"Authorization": f"Bearer {service_token}", "Accept": "application/json"}
    resp = requests.delete(url, headers=headers, timeout=30)
    if resp.status_code == 404:
        return
    resp.raise_for_status()

def purge_user(user_id: str, service_token: str) -> None:
    projects = list_projects(service_token)
    print("**********************************************")
    print(str(user_id))
    print(projects)
    print("**********************************************")
    for proj in projects:
        print("**********************************************")
        print(proj.get("ownerId"))
        print("**********************************************")
        if proj.get("ownerId") == user_id:
            print("###################################")
            print("User id")
            print(user_id)
            print("Project id")
            print(proj["id"])
            delete_project(proj["id"], service_token)

    delete_user(user_id, service_token)
