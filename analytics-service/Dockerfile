FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py .
EXPOSE 8000
# "::" listens on IPv6 and IPv4; Railway's private network is IPv6.
CMD ["sh", "-c", "exec uvicorn main:app --host :: --port ${PORT:-8000}"]
