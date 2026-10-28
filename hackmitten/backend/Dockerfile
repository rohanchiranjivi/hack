FROM python:3.11-slim
WORKDIR /workspace
COPY backend/requirements.txt ./backend/requirements.txt
COPY backend/app ./backend/app
COPY data ./data
COPY reports ./reports
WORKDIR /workspace/backend
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
EXPOSE 8000
CMD ["uvicorn","app.main:app","--host","0.0.0.0","--port","8000"]
