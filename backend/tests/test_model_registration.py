import os
import subprocess
import sys
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]


def test_worker_import_registers_all_models() -> None:
    env = os.environ.copy()
    env["PYTHONPATH"] = str(BACKEND_DIR) + os.pathsep + env.get("PYTHONPATH", "")

    proc = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "from sqlmodel import SQLModel; "
                "import app.workers.tasks; "
                "required = {'watchjob', 'appuser', 'occupant', 'adapter_occupant', 'adaptercredential', 'cartsession'}; "
                "missing = sorted(required - set(SQLModel.metadata.tables)); "
                "assert not missing, missing"
            ),
        ],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
    )

    assert proc.returncode == 0, (
        f"worker import did not register all models\n"
        f"stdout:\n{proc.stdout}\n"
        f"stderr:\n{proc.stderr}"
    )
