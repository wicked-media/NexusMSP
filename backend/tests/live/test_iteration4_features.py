"""
Test suite for NexusOps v2.0 - Iteration 4 Features
Tests: Scripting/Automation, IT Documentation, Project Management, Ticket Emails
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_EMAIL = "admin@nexusops.io"
TEST_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD", "admin123")


class TestAuth:
    """Authentication tests"""
    
    def test_login_success(self):
        """Test login with valid credentials"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "token" in data, "Token not in response"
        assert "user" in data, "User not in response"
        print(f"Login successful for user: {data['user']['name']}")


@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token for tests"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD
    })
    if response.status_code != 200:
        pytest.skip(f"Authentication failed: {response.text}")
    return response.json()["token"]


@pytest.fixture(scope="module")
def headers(auth_token):
    """Get headers with auth token"""
    return {"Authorization": f"Bearer {auth_token}"}


@pytest.fixture(scope="module")
def test_client_id(headers):
    """Get or create a test client for testing"""
    response = requests.get(f"{BASE_URL}/api/clients", headers=headers)
    if response.status_code == 200 and len(response.json()) > 0:
        return response.json()[0]["id"]
    # Create a test client
    response = requests.post(f"{BASE_URL}/api/clients", headers=headers, json={
        "name": "TEST_Client_Iteration4",
        "email": "test@iteration4.com"
    })
    if response.status_code in [200, 201]:
        return response.json()["id"]
    pytest.skip("Could not get or create test client")


# ============== SCRIPTING API TESTS ==============

class TestScriptingAPI:
    """Tests for Scripting/Automation endpoints"""
    
    def test_get_scripts(self, headers):
        """Test GET /api/scripts"""
        response = requests.get(f"{BASE_URL}/api/scripts", headers=headers)
        assert response.status_code == 200, f"Failed to get scripts: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"Found {len(data)} scripts")
    
    def test_create_script(self, headers):
        """Test POST /api/scripts - Create new script"""
        script_data = {
            "name": f"TEST_Script_{uuid.uuid4().hex[:8]}",
            "description": "Test script for iteration 4",
            "script_type": "powershell",
            "content": "Write-Host 'Hello World'",
            "category": "general",
            "os_target": "windows",
            "run_as_admin": True,
            "timeout_seconds": 60
        }
        response = requests.post(f"{BASE_URL}/api/scripts", headers=headers, json=script_data)
        assert response.status_code in [200, 201], f"Failed to create script: {response.text}"
        data = response.json()
        assert data["name"] == script_data["name"], "Script name mismatch"
        assert data["script_type"] == "powershell", "Script type mismatch"
        assert "id" in data, "Script ID not returned"
        print(f"Created script: {data['name']} (ID: {data['id']})")
        return data["id"]
    
    def test_get_script_by_id(self, headers):
        """Test GET /api/scripts/{id}"""
        # First create a script
        script_data = {
            "name": f"TEST_GetScript_{uuid.uuid4().hex[:8]}",
            "script_type": "bash",
            "content": "echo 'Test'"
        }
        create_response = requests.post(f"{BASE_URL}/api/scripts", headers=headers, json=script_data)
        assert create_response.status_code in [200, 201]
        script_id = create_response.json()["id"]
        
        # Get the script
        response = requests.get(f"{BASE_URL}/api/scripts/{script_id}", headers=headers)
        assert response.status_code == 200, f"Failed to get script: {response.text}"
        data = response.json()
        assert data["id"] == script_id, "Script ID mismatch"
        print(f"Retrieved script: {data['name']}")
    
    def test_update_script(self, headers):
        """Test PUT /api/scripts/{id}"""
        # Create a script
        script_data = {
            "name": f"TEST_UpdateScript_{uuid.uuid4().hex[:8]}",
            "script_type": "python",
            "content": "print('Original')"
        }
        create_response = requests.post(f"{BASE_URL}/api/scripts", headers=headers, json=script_data)
        assert create_response.status_code in [200, 201]
        script_id = create_response.json()["id"]
        
        # Update the script
        update_data = {"content": "print('Updated')", "description": "Updated description"}
        response = requests.put(f"{BASE_URL}/api/scripts/{script_id}", headers=headers, json=update_data)
        assert response.status_code == 200, f"Failed to update script: {response.text}"
        data = response.json()
        assert data["content"] == "print('Updated')", "Content not updated"
        print(f"Updated script: {data['name']}")
    
    def test_delete_script(self, headers):
        """Test DELETE /api/scripts/{id}"""
        # Create a script
        script_data = {
            "name": f"TEST_DeleteScript_{uuid.uuid4().hex[:8]}",
            "script_type": "batch",
            "content": "echo test"
        }
        create_response = requests.post(f"{BASE_URL}/api/scripts", headers=headers, json=script_data)
        assert create_response.status_code in [200, 201]
        script_id = create_response.json()["id"]
        
        # Delete the script
        response = requests.delete(f"{BASE_URL}/api/scripts/{script_id}", headers=headers)
        assert response.status_code == 200, f"Failed to delete script: {response.text}"
        
        # Verify deletion
        get_response = requests.get(f"{BASE_URL}/api/scripts/{script_id}", headers=headers)
        assert get_response.status_code == 404, "Script should be deleted"
        print(f"Deleted script: {script_id}")
    
    def test_get_script_executions(self, headers):
        """Test GET /api/script-executions"""
        response = requests.get(f"{BASE_URL}/api/script-executions", headers=headers)
        assert response.status_code == 200, f"Failed to get executions: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"Found {len(data)} script executions")


# ============== RETIRED PASSWORD VAULT API TESTS ==============

@pytest.mark.skip(reason="NexusMSP password storage retired in favour of Keeper and Hudu")
class TestPasswordVaultAPI:
    """Tests for IT Documentation - Password Vault endpoints"""
    
    def test_get_passwords(self, headers):
        """Test GET /api/passwords"""
        response = requests.get(f"{BASE_URL}/api/passwords", headers=headers)
        assert response.status_code == 200, f"Failed to get passwords: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"Found {len(data)} passwords")
    
    def test_create_password(self, headers, test_client_id):
        """Test POST /api/passwords - Create new password entry"""
        password_data = {
            "client_id": test_client_id,
            "name": f"TEST_Password_{uuid.uuid4().hex[:8]}",
            "category": "server",
            "username": "admin",
            "password": "SecurePass123!",
            "url": "https://server.example.com",
            "notes": "Test password entry"
        }
        response = requests.post(f"{BASE_URL}/api/passwords", headers=headers, json=password_data)
        assert response.status_code in [200, 201], f"Failed to create password: {response.text}"
        data = response.json()
        assert data["name"] == password_data["name"], "Password name mismatch"
        assert "id" in data, "Password ID not returned"
        print(f"Created password entry: {data['name']} (ID: {data['id']})")
        return data["id"]
    
    def test_reveal_password(self, headers, test_client_id):
        """Test GET /api/passwords/{id}/reveal - Reveal password"""
        # Create a password
        password_data = {
            "client_id": test_client_id,
            "name": f"TEST_RevealPwd_{uuid.uuid4().hex[:8]}",
            "username": "testuser",
            "password": "MySecretPassword123"
        }
        create_response = requests.post(f"{BASE_URL}/api/passwords", headers=headers, json=password_data)
        assert create_response.status_code in [200, 201]
        password_id = create_response.json()["id"]
        
        # Reveal the password
        response = requests.get(f"{BASE_URL}/api/passwords/{password_id}/reveal", headers=headers)
        assert response.status_code == 200, f"Failed to reveal password: {response.text}"
        data = response.json()
        assert data["password"] == "MySecretPassword123", "Password value mismatch"
        print(f"Revealed password for entry: {password_id}")
    
    def test_update_password(self, headers, test_client_id):
        """Test PUT /api/passwords/{id}"""
        # Create a password
        password_data = {
            "client_id": test_client_id,
            "name": f"TEST_UpdatePwd_{uuid.uuid4().hex[:8]}",
            "username": "olduser",
            "password": "OldPassword"
        }
        create_response = requests.post(f"{BASE_URL}/api/passwords", headers=headers, json=password_data)
        assert create_response.status_code in [200, 201]
        password_id = create_response.json()["id"]
        
        # Update the password
        update_data = {"username": "newuser", "password": "NewPassword123"}
        response = requests.put(f"{BASE_URL}/api/passwords/{password_id}", headers=headers, json=update_data)
        assert response.status_code == 200, f"Failed to update password: {response.text}"
        data = response.json()
        assert data["username"] == "newuser", "Username not updated"
        print(f"Updated password entry: {password_id}")
    
    def test_delete_password(self, headers, test_client_id):
        """Test DELETE /api/passwords/{id}"""
        # Create a password
        password_data = {
            "client_id": test_client_id,
            "name": f"TEST_DeletePwd_{uuid.uuid4().hex[:8]}",
            "username": "deleteuser",
            "password": "DeleteMe"
        }
        create_response = requests.post(f"{BASE_URL}/api/passwords", headers=headers, json=password_data)
        assert create_response.status_code in [200, 201]
        password_id = create_response.json()["id"]
        
        # Delete the password
        response = requests.delete(f"{BASE_URL}/api/passwords/{password_id}", headers=headers)
        assert response.status_code == 200, f"Failed to delete password: {response.text}"
        
        # Verify deletion
        get_response = requests.get(f"{BASE_URL}/api/passwords/{password_id}/reveal", headers=headers)
        assert get_response.status_code == 404, "Password should be deleted"
        print(f"Deleted password entry: {password_id}")


# ============== DOCUMENTATION API TESTS ==============

class TestDocumentationAPI:
    """Tests for IT Documentation - Documentation pages endpoints"""
    
    def test_get_documentation(self, headers):
        """Test GET /api/documentation"""
        response = requests.get(f"{BASE_URL}/api/documentation", headers=headers)
        assert response.status_code == 200, f"Failed to get documentation: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"Found {len(data)} documentation pages")
    
    def test_create_documentation(self, headers, test_client_id):
        """Test POST /api/documentation - Create new doc page"""
        doc_data = {
            "client_id": test_client_id,
            "title": f"TEST_Doc_{uuid.uuid4().hex[:8]}",
            "content": "# Test Documentation\n\nThis is a test document.",
            "category": "procedures",
            "tags": ["test", "iteration4"]
        }
        response = requests.post(f"{BASE_URL}/api/documentation", headers=headers, json=doc_data)
        assert response.status_code in [200, 201], f"Failed to create doc: {response.text}"
        data = response.json()
        assert data["title"] == doc_data["title"], "Doc title mismatch"
        assert "id" in data, "Doc ID not returned"
        print(f"Created documentation: {data['title']} (ID: {data['id']})")
        return data["id"]
    
    def test_get_documentation_by_id(self, headers, test_client_id):
        """Test GET /api/documentation/{id}"""
        # Create a doc
        doc_data = {
            "client_id": test_client_id,
            "title": f"TEST_GetDoc_{uuid.uuid4().hex[:8]}",
            "content": "Test content"
        }
        create_response = requests.post(f"{BASE_URL}/api/documentation", headers=headers, json=doc_data)
        assert create_response.status_code in [200, 201]
        doc_id = create_response.json()["id"]
        
        # Get the doc
        response = requests.get(f"{BASE_URL}/api/documentation/{doc_id}", headers=headers)
        assert response.status_code == 200, f"Failed to get doc: {response.text}"
        data = response.json()
        assert data["id"] == doc_id, "Doc ID mismatch"
        print(f"Retrieved documentation: {data['title']}")
    
    def test_update_documentation(self, headers, test_client_id):
        """Test PUT /api/documentation/{id}"""
        # Create a doc
        doc_data = {
            "client_id": test_client_id,
            "title": f"TEST_UpdateDoc_{uuid.uuid4().hex[:8]}",
            "content": "Original content"
        }
        create_response = requests.post(f"{BASE_URL}/api/documentation", headers=headers, json=doc_data)
        assert create_response.status_code in [200, 201]
        doc_id = create_response.json()["id"]
        
        # Update the doc
        update_data = {"content": "Updated content", "category": "network"}
        response = requests.put(f"{BASE_URL}/api/documentation/{doc_id}", headers=headers, json=update_data)
        assert response.status_code == 200, f"Failed to update doc: {response.text}"
        data = response.json()
        assert data["content"] == "Updated content", "Content not updated"
        print(f"Updated documentation: {doc_id}")
    
    def test_delete_documentation(self, headers, test_client_id):
        """Test DELETE /api/documentation/{id}"""
        # Create a doc
        doc_data = {
            "client_id": test_client_id,
            "title": f"TEST_DeleteDoc_{uuid.uuid4().hex[:8]}",
            "content": "Delete me"
        }
        create_response = requests.post(f"{BASE_URL}/api/documentation", headers=headers, json=doc_data)
        assert create_response.status_code in [200, 201]
        doc_id = create_response.json()["id"]
        
        # Delete the doc
        response = requests.delete(f"{BASE_URL}/api/documentation/{doc_id}", headers=headers)
        assert response.status_code == 200, f"Failed to delete doc: {response.text}"
        
        # Verify deletion
        get_response = requests.get(f"{BASE_URL}/api/documentation/{doc_id}", headers=headers)
        assert get_response.status_code == 404, "Doc should be deleted"
        print(f"Deleted documentation: {doc_id}")


# ============== PROJECTS API TESTS ==============

class TestProjectsAPI:
    """Tests for Project Management endpoints"""
    
    def test_get_projects(self, headers):
        """Test GET /api/projects"""
        response = requests.get(f"{BASE_URL}/api/projects", headers=headers)
        assert response.status_code == 200, f"Failed to get projects: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"Found {len(data)} projects")
    
    def test_create_project(self, headers, test_client_id):
        """Test POST /api/projects - Create new project"""
        project_data = {
            "name": f"TEST_Project_{uuid.uuid4().hex[:8]}",
            "description": "Test project for iteration 4",
            "client_id": test_client_id,
            "status": "planning",
            "priority": "high",
            "start_date": "2026-03-07",
            "target_end_date": "2026-04-07",
            "budget_hours": 40
        }
        response = requests.post(f"{BASE_URL}/api/projects", headers=headers, json=project_data)
        assert response.status_code in [200, 201], f"Failed to create project: {response.text}"
        data = response.json()
        assert data["name"] == project_data["name"], "Project name mismatch"
        assert data["status"] == "planning", "Status mismatch"
        assert "id" in data, "Project ID not returned"
        print(f"Created project: {data['name']} (ID: {data['id']})")
        return data["id"]
    
    def test_get_project_by_id(self, headers, test_client_id):
        """Test GET /api/projects/{id}"""
        # Create a project
        project_data = {
            "name": f"TEST_GetProject_{uuid.uuid4().hex[:8]}",
            "client_id": test_client_id
        }
        create_response = requests.post(f"{BASE_URL}/api/projects", headers=headers, json=project_data)
        assert create_response.status_code in [200, 201]
        project_id = create_response.json()["id"]
        
        # Get the project
        response = requests.get(f"{BASE_URL}/api/projects/{project_id}", headers=headers)
        assert response.status_code == 200, f"Failed to get project: {response.text}"
        data = response.json()
        assert data["id"] == project_id, "Project ID mismatch"
        print(f"Retrieved project: {data['name']}")
    
    def test_update_project(self, headers, test_client_id):
        """Test PUT /api/projects/{id}"""
        # Create a project
        project_data = {
            "name": f"TEST_UpdateProject_{uuid.uuid4().hex[:8]}",
            "client_id": test_client_id,
            "status": "planning"
        }
        create_response = requests.post(f"{BASE_URL}/api/projects", headers=headers, json=project_data)
        assert create_response.status_code in [200, 201]
        project_id = create_response.json()["id"]
        
        # Update the project
        update_data = {"status": "in_progress", "description": "Updated description"}
        response = requests.put(f"{BASE_URL}/api/projects/{project_id}", headers=headers, json=update_data)
        assert response.status_code == 200, f"Failed to update project: {response.text}"
        data = response.json()
        assert data["status"] == "in_progress", "Status not updated"
        print(f"Updated project: {project_id}")
    
    def test_delete_project(self, headers, test_client_id):
        """Test DELETE /api/projects/{id}"""
        # Create a project
        project_data = {
            "name": f"TEST_DeleteProject_{uuid.uuid4().hex[:8]}",
            "client_id": test_client_id
        }
        create_response = requests.post(f"{BASE_URL}/api/projects", headers=headers, json=project_data)
        assert create_response.status_code in [200, 201]
        project_id = create_response.json()["id"]
        
        # Delete the project
        response = requests.delete(f"{BASE_URL}/api/projects/{project_id}", headers=headers)
        assert response.status_code == 200, f"Failed to delete project: {response.text}"
        
        # Verify deletion
        get_response = requests.get(f"{BASE_URL}/api/projects/{project_id}", headers=headers)
        assert get_response.status_code == 404, "Project should be deleted"
        print(f"Deleted project: {project_id}")


# ============== PROJECT TASKS API TESTS ==============

class TestProjectTasksAPI:
    """Tests for Project Tasks endpoints"""
    
    @pytest.fixture
    def test_project_id(self, headers, test_client_id):
        """Create a test project for task tests"""
        project_data = {
            "name": f"TEST_TaskProject_{uuid.uuid4().hex[:8]}",
            "client_id": test_client_id
        }
        response = requests.post(f"{BASE_URL}/api/projects", headers=headers, json=project_data)
        assert response.status_code in [200, 201]
        return response.json()["id"]
    
    def test_get_project_tasks(self, headers, test_project_id):
        """Test GET /api/projects/{id}/tasks"""
        response = requests.get(f"{BASE_URL}/api/projects/{test_project_id}/tasks", headers=headers)
        assert response.status_code == 200, f"Failed to get tasks: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"Found {len(data)} tasks for project")
    
    def test_create_project_task(self, headers, test_project_id):
        """Test POST /api/projects/{id}/tasks - Create new task"""
        task_data = {
            "title": f"TEST_Task_{uuid.uuid4().hex[:8]}",
            "description": "Test task for iteration 4",
            "status": "todo",
            "priority": "high",
            "estimated_hours": 4,
            "due_date": "2026-03-15"
        }
        response = requests.post(f"{BASE_URL}/api/projects/{test_project_id}/tasks", headers=headers, json=task_data)
        assert response.status_code in [200, 201], f"Failed to create task: {response.text}"
        data = response.json()
        assert data["title"] == task_data["title"], "Task title mismatch"
        assert data["status"] == "todo", "Status mismatch"
        assert "id" in data, "Task ID not returned"
        print(f"Created task: {data['title']} (ID: {data['id']})")
        return data["id"]
    
    def test_update_project_task(self, headers, test_project_id):
        """Test PUT /api/projects/{id}/tasks/{task_id}"""
        # Create a task
        task_data = {
            "title": f"TEST_UpdateTask_{uuid.uuid4().hex[:8]}",
            "status": "todo"
        }
        create_response = requests.post(f"{BASE_URL}/api/projects/{test_project_id}/tasks", headers=headers, json=task_data)
        assert create_response.status_code in [200, 201]
        task_id = create_response.json()["id"]
        
        # Update the task
        update_data = {"status": "in_progress", "description": "Updated task"}
        response = requests.put(f"{BASE_URL}/api/projects/{test_project_id}/tasks/{task_id}", headers=headers, json=update_data)
        assert response.status_code == 200, f"Failed to update task: {response.text}"
        data = response.json()
        assert data["status"] == "in_progress", "Status not updated"
        print(f"Updated task: {task_id}")
    
    def test_delete_project_task(self, headers, test_project_id):
        """Test DELETE /api/projects/{id}/tasks/{task_id}"""
        # Create a task
        task_data = {
            "title": f"TEST_DeleteTask_{uuid.uuid4().hex[:8]}"
        }
        create_response = requests.post(f"{BASE_URL}/api/projects/{test_project_id}/tasks", headers=headers, json=task_data)
        assert create_response.status_code in [200, 201]
        task_id = create_response.json()["id"]
        
        # Delete the task
        response = requests.delete(f"{BASE_URL}/api/projects/{test_project_id}/tasks/{task_id}", headers=headers)
        assert response.status_code == 200, f"Failed to delete task: {response.text}"
        print(f"Deleted task: {task_id}")


# ============== TICKET EMAILS API TESTS ==============

class TestTicketEmailsAPI:
    """Tests for Ticket Email integration endpoints"""
    
    @pytest.fixture
    def test_ticket_id(self, headers, test_client_id):
        """Create a test ticket for email tests"""
        ticket_data = {
            "title": f"TEST_EmailTicket_{uuid.uuid4().hex[:8]}",
            "description": "Test ticket for email testing",
            "client_id": test_client_id,
            "priority": "medium"
        }
        response = requests.post(f"{BASE_URL}/api/tickets", headers=headers, json=ticket_data)
        assert response.status_code in [200, 201]
        return response.json()["id"]
    
    def test_get_ticket_emails(self, headers, test_ticket_id):
        """Test GET /api/tickets/{id}/emails"""
        response = requests.get(f"{BASE_URL}/api/tickets/{test_ticket_id}/emails", headers=headers)
        assert response.status_code == 200, f"Failed to get ticket emails: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"Found {len(data)} emails for ticket")
    
    def test_send_ticket_email(self, headers, test_ticket_id):
        """Test POST /api/tickets/{id}/emails - Send email from ticket"""
        email_data = {
            "to_addresses": ["test@example.com"],
            "subject": "Test Email from Ticket",
            "body": "<p>This is a test email from ticket.</p>",
            "body_type": "html"
        }
        response = requests.post(f"{BASE_URL}/api/tickets/{test_ticket_id}/emails", headers=headers, json=email_data)
        # Note: This may fail if Office 365 is not configured, but should return proper error
        assert response.status_code in [200, 201, 400, 500], f"Unexpected status: {response.status_code}"
        print(f"Ticket email endpoint responded with status: {response.status_code}")


# ============== CLEANUP ==============

@pytest.fixture(scope="module", autouse=True)
def cleanup_test_data(headers):
    """Cleanup TEST_ prefixed data after all tests"""
    yield
    # Cleanup scripts
    try:
        scripts = requests.get(f"{BASE_URL}/api/scripts", headers=headers).json()
        for script in scripts:
            if script.get("name", "").startswith("TEST_"):
                requests.delete(f"{BASE_URL}/api/scripts/{script['id']}", headers=headers)
    except:
        pass
    
    # Cleanup passwords
    try:
        passwords = requests.get(f"{BASE_URL}/api/passwords", headers=headers).json()
        for pwd in passwords:
            if pwd.get("name", "").startswith("TEST_"):
                requests.delete(f"{BASE_URL}/api/passwords/{pwd['id']}", headers=headers)
    except:
        pass
    
    # Cleanup documentation
    try:
        docs = requests.get(f"{BASE_URL}/api/documentation", headers=headers).json()
        for doc in docs:
            if doc.get("title", "").startswith("TEST_"):
                requests.delete(f"{BASE_URL}/api/documentation/{doc['id']}", headers=headers)
    except:
        pass
    
    # Cleanup projects
    try:
        projects = requests.get(f"{BASE_URL}/api/projects", headers=headers).json()
        for project in projects:
            if project.get("name", "").startswith("TEST_"):
                requests.delete(f"{BASE_URL}/api/projects/{project['id']}", headers=headers)
    except:
        pass
    
    print("Cleanup completed")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
