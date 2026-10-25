"""Background worker: claim Redis jobs and run registered handlers."""

from __future__ import annotations

import logging
import os
import time

from dotenv import load_dotenv

from api.jobs import claim_next, queue_mode, register_handler, run_job

logger = logging.getLogger("api.worker")


def _register_defaults() -> None:
    from api.job_handlers import register_default_handlers

    register_default_handlers(register_handler)


def main() -> None:
    env = os.environ.get("DOTENV_PATH") or ".env"
    if os.path.isfile(env):
        load_dotenv(env, override=False)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    if queue_mode() != "redis":
        logger.warning("QUEUE is %s; worker expects QUEUE=redis", queue_mode())
    _register_defaults()
    logger.info("worker listening")
    while True:
        job_id = claim_next()
        if job_id is None:
            time.sleep(0.2)
            continue
        logger.info("running job %s", job_id)
        state = run_job(job_id)
        logger.info("job %s -> %s", job_id, state.status)


if __name__ == "__main__":
    main()
