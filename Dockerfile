# Stage 1: Builder
FROM python:3.14.4-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies into a local directory
COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# Stage 2: Runner
FROM python:3.14.4-slim AS runner

WORKDIR /app

# Create a non-root user and ensure data directory exists with correct permissions
RUN useradd -m appuser && \
    mkdir -p /app/data && \
    chown -R appuser:appuser /app && \
    chmod 755 /app/data
USER appuser

# Copy only the installed python packages from the builder stage
# Python --user installs go to ~/.local
COPY --from=builder --chown=appuser:appuser /root/.local /home/appuser/.local
COPY --from=builder --chown=appuser:appuser /app /app

# Ensure the local bin is in PATH
ENV PATH=/home/appuser/.local/bin:$PATH

# Copy application source code
COPY --chown=appuser:appuser . .

# Make entrypoint script executable
RUN chmod +x /app/scripts/entrypoint.sh

# Expose port
EXPOSE 8000

# Set entrypoint to handle migrations and wait-for-db
ENTRYPOINT ["/app/scripts/entrypoint.sh"]

# Command to run the application (passed as arguments to entrypoint)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
