FROM python:3.12-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Build context must be repo root: docker build -f backend/Dockerfile .
COPY backend/templates ./templates
COPY backend/job_controller ./job_controller

ENV TEMPLATE_DIR=/app/templates

ENTRYPOINT ["python3", "-m", "job_controller.main"]
