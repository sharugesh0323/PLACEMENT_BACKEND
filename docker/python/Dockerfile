FROM python:3.11-slim

# Create non-root user for security
RUN useradd -m -s /bin/bash coderunner && \
    mkdir -p /code && \
    chown coderunner:coderunner /code

# Set resource limits
WORKDIR /code
USER coderunner

# Default command - execute a Python file
CMD ["python3", "/code/solution.py"]
