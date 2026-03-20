FROM python:3.11-slim

RUN useradd -m -s /bin/bash coderunner && \
    mkdir -p /code && \
    chown coderunner:coderunner /code

WORKDIR /code
COPY runner.py /opt/runner.py
USER coderunner

CMD ["python3", "/opt/runner.py"]
