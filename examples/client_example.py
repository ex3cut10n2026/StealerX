import requests
import hashlib
import uuid
import sys

# Configuration
API_URL = "http://localhost:5000/api/client"
APP_NAME = "My Python Script"
# Replace with the actual secret from your Dashboard
APP_SECRET = "YOUR_APP_SECRET_HERE" 

def get_hwid():
    # Simple HWID generation based on machine details
    mac = uuid.getnode()
    return hashlib.sha256(str(mac).encode()).hexdigest()

def main():
    print("=== KeyShield Client Authentication ===")
    
    # 1. Handshake (Initialize Session)
    print("[*] Connecting to server...")
    try:
        response = requests.post(f"{API_URL}/init", json={
            "app_name": APP_NAME,
            "secret": APP_SECRET
        })
        res_data = response.json()
        if not res_data.get("success"):
            print(f"[-] Handshake Failed: {res_data.get('message')}")
            sys.exit(1)
        
        session_id = res_data.get("session_id")
        print(f"[+] Handshake successful. Session ID: {session_id[:8]}...")
        
    except Exception as e:
        print(f"[-] Connection Error: {e}")
        sys.exit(1)

    # 2. Authenticate License Key
    license_key = input("Enter your License Key: ").strip()
    hwid = get_hwid()
    
    print("[*] Validating key...")
    try:
        response = requests.post(f"{API_URL}/login", json={
            "session_id": session_id,
            "key": license_key,
            "hwid": hwid
        })
        res_data = response.json()
        if not res_data.get("success"):
            print(f"[-] Validation Failed: {res_data.get('message')}")
            sys.exit(1)
            
        print("[+] Access Granted!")
        print(f"    Expires: {res_data.get('expiry')}")
        
    except Exception as e:
        print(f"[-] Validation Error: {e}")
        sys.exit(1)

    # 3. Retrieve secure remote variable
    # In KeyAuth/KeyShield, you store secrets on the server so users can't crack/extract them.
    var_name = "welcome_msg"
    print(f"[*] Fetching remote variable: {var_name}")
    try:
        response = requests.post(f"{API_URL}/var", json={
            "session_id": session_id,
            "name": var_name
        })
        res_data = response.json()
        if res_data.get("success"):
            print(f"[+] Variable Value: {res_data.get('value')}")
        else:
            print(f"[-] Failed to fetch variable: {res_data.get('message')}")
    except Exception as e:
        print(f"[-] Fetching Variable Error: {e}")

    # 4. Remote Logging
    print("[*] Sending client activity log...")
    try:
        requests.post(f"{API_URL}/log", json={
            "session_id": session_id,
            "message": "User started the main script operations."
        })
    except:
        pass

    print("[+] Hello from your protected script! Running main code...")

if __name__ == "__main__":
    main()
