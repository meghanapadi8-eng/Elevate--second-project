import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from backend import main


class BackendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory()
        main.DB_PATH = Path(cls.temp_dir.name) / "test.sqlite3"
        cls.client_context = TestClient(main.app)
        cls.client = cls.client_context.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.client_context.__exit__(None, None, None)
        cls.temp_dir.cleanup()

    def register(self, email):
        response = self.client.post(
            "/auth/register",
            json={"name": "Test User", "email": email, "password": "valid-password-123"},
        )
        self.assertEqual(response.status_code, 201)
        return response.json()["token"]

    def test_registration_login_and_logout(self):
        token = self.register("first@example.com")
        headers = {"Authorization": f"Bearer {token}"}
        self.assertEqual(self.client.get("/auth/me", headers=headers).json()["user"]["email"], "first@example.com")
        login = self.client.post("/auth/login", json={"email": "first@example.com", "password": "valid-password-123"})
        self.assertEqual(login.status_code, 200)
        self.assertEqual(self.client.post("/auth/logout", headers=headers).status_code, 200)
        self.assertEqual(self.client.get("/auth/me", headers=headers).status_code, 401)

    def test_user_records_are_private(self):
        first = self.register("owner@example.com")
        second = self.register("other@example.com")
        first_headers = {"Authorization": f"Bearer {first}"}
        second_headers = {"Authorization": f"Bearer {second}"}
        saved = self.client.post(
            "/applications",
            headers=first_headers,
            json={"jobKey": "Engineer|Example", "data": {"title": "Engineer", "status": "Applied"}},
        )
        self.assertEqual(saved.status_code, 201)
        self.assertEqual(len(self.client.get("/applications", headers=first_headers).json()["applications"]), 1)
        self.assertEqual(self.client.get("/applications", headers=second_headers).json()["applications"], [])

    def test_workspace_data_appears_in_dashboard_and_analytics(self):
        headers = {"Authorization": f"Bearer {self.register('workspace@example.com')}"}
        profile = self.client.put(
            "/profile",
            headers=headers,
            json={"headline": "QA Engineer", "skills": ["Testing"], "preferences": {"role": "QA Engineer"}},
        )
        self.assertEqual(profile.status_code, 200)
        resume = self.client.post(
            "/resumes",
            headers=headers,
            json={"name": "QA resume", "data": {"jobTitle": "QA Engineer", "summary": "Test systems."}},
        )
        self.assertEqual(resume.status_code, 201)
        self.client.post(
            "/applications",
            headers=headers,
            json={"jobKey": "QA Engineer|Elevate", "data": {"status": "Interview", "appliedAt": 1794820000000}},
        )
        dashboard = self.client.get("/dashboard", headers=headers).json()["stats"]
        self.assertEqual(dashboard["savedResumes"], 1)
        self.assertEqual(dashboard["applications"]["interview"], 1)
        analytics = self.client.get("/analytics", headers=headers).json()["analytics"]
        self.assertEqual(analytics["counts"]["Interview"], 1)

    def test_protected_route_rejects_missing_token(self):
        self.assertEqual(self.client.get("/resumes").status_code, 401)

    def test_health_reports_sqlite(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["database"], "ok")


if __name__ == "__main__":
    unittest.main()
