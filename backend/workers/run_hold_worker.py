import logging
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

logging.basicConfig(level=logging.INFO)

if __name__ == "__main__":
    from arq.worker import run_worker
    from app.workers.hold_worker import HoldWorkerSettings
    run_worker(HoldWorkerSettings)  # type: ignore[arg-type]
