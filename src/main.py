
"""
SAKHI Cloudflare Python Worker entrypoint.

api_link.py owns the FastAPI application and all API routes.
backend.py contains the business logic.
"""

from workers import asgi
from api_link import app

# Export the existing FastAPI application to Cloudflare Workers.
Default = asgi.entrypoint(app)
