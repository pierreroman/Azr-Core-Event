"""
Load test for Azure Infra Summit (azureinfrasummit.com)
------------------------------------------------------
Simulates realistic user behavior across the event website:
  - 50% browse homepage (heaviest traffic)
  - 15% view schedule via API
  - 15% view speakers via API
  -  5% view sponsors via API
  -  5% read about page content
  -  5% read code of conduct
  -  5% load CSS/assets

Designed for 10,000 concurrent users across 3 regions via Azure Load Testing.

Usage (local):
  locust -f locustfile.py --host https://www.azureinfrasummit.com -u 100 -r 10 --run-time 5m

Usage (Azure Load Testing):
  Upload this file + load-test-config.yaml to Azure Load Testing.
"""

import os
import logging
from locust import HttpUser, task, between, events

logging.basicConfig(level=logging.WARNING)

# Region tag for multi-region test identification
REGION = os.getenv("REGION", "default")


class EventAttendee(HttpUser):
    """Simulates a typical event attendee browsing the site."""

    wait_time = between(1, 5)  # Think time between requests
    host = os.getenv("HOST", "https://gentle-tree-01406420f.1.azurestaticapps.net")

    # ── Page loads (browser-like) ────────────────────────────────

    @task(50)
    def browse_homepage(self):
        """Load the main event page — highest traffic."""
        with self.client.get("/", name=f"[{REGION}] GET / (homepage)", catch_response=True) as r:
            if r.status_code == 200:
                r.success()
            else:
                r.failure(f"Homepage returned {r.status_code}")

    @task(5)
    def load_styles(self):
        """Load the main stylesheet."""
        self.client.get("/styles.css", name=f"[{REGION}] GET /styles.css")

    # ── API endpoints (XHR calls the page makes) ────────────────

    @task(15)
    def get_schedule(self):
        """Fetch the event schedule — called on every page load."""
        with self.client.get("/api/schedule", name=f"[{REGION}] GET /api/schedule", catch_response=True) as r:
            if r.status_code == 200:
                r.success()
            else:
                r.failure(f"Schedule API returned {r.status_code}")

    @task(15)
    def get_speakers(self):
        """Fetch speaker list."""
        with self.client.get("/api/speakers", name=f"[{REGION}] GET /api/speakers", catch_response=True) as r:
            if r.status_code == 200:
                r.success()
            else:
                r.failure(f"Speakers API returned {r.status_code}")

    @task(5)
    def get_sponsors(self):
        """Fetch sponsor list."""
        with self.client.get("/api/sponsors", name=f"[{REGION}] GET /api/sponsors", catch_response=True) as r:
            if r.status_code == 200:
                r.success()
            else:
                r.failure(f"Sponsors API returned {r.status_code}")

    @task(5)
    def get_about_content(self):
        """Fetch about page markdown content."""
        with self.client.get("/api/content/about", name=f"[{REGION}] GET /api/content/about", catch_response=True) as r:
            if r.status_code == 200:
                r.success()
            else:
                r.failure(f"About content returned {r.status_code}")

    @task(5)
    def get_code_of_conduct(self):
        """Fetch code of conduct."""
        self.client.get("/api/content/code-of-conduct", name=f"[{REGION}] GET /api/content/code-of-conduct")