import logging
import sys
import os

# Make sure app is importable
sys.path.insert(0, os.path.dirname(__file__))

logging.basicConfig(level=logging.INFO)

if __name__ == "__main__":
    from arq.worker import run_worker
    from app.workers.tasks import HoldWorkerSettings
    run_worker(HoldWorkerSettings)  # type: ignore[arg-type]
