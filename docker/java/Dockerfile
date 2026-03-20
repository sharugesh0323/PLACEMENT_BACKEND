FROM eclipse-temurin:17-jdk-jammy

# Create non-root user for security
RUN useradd -m -s /bin/bash coderunner && \
    mkdir -p /code && \
    chown coderunner:coderunner /code

# Set resource limits
WORKDIR /code
USER coderunner

# Default command - compile and execute a Java file
CMD ["sh", "-c", "javac -d /tmp /code/Solution.java && java -cp /tmp Solution"]
