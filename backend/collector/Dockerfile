FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir httpx==0.28.1

COPY main.py .

ENTRYPOINT ["python3", "main.py"]
