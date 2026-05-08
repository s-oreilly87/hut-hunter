import pytest
from app.models.job import JobStatus

pytestmark = pytest.mark.asyncio

async def test_completed_job_cannot_be_edited(client, seed_job, make_job_params):
    job = await seed_job(
        params=make_job_params(name="Original Name"),
        status=JobStatus.BOOKING_COMPLETE.value,
    )
    
    response = await client.patch(
        f"/api/v1/jobs/{job.id}",
        json={"name": "New Name"}
    )
    
    assert response.status_code == 403
    assert response.json()["detail"] == "Completed bookings are locked and cannot be edited."

async def test_completed_job_cannot_be_triggered(client, seed_job, make_job_params):
    job = await seed_job(
        params=make_job_params(),
        status=JobStatus.BOOKING_COMPLETE.value,
    )
    
    response = await client.post(f"/api/v1/jobs/{job.id}/trigger")
    
    assert response.status_code == 409
    assert response.json()["detail"] == "This job is already booked and cannot be triggered again."

async def test_completed_job_cannot_be_booked_again(client, seed_job, make_job_params):
    job = await seed_job(
        params=make_job_params(),
        status=JobStatus.BOOKING_COMPLETE.value,
    )
    
    response = await client.post(f"/api/v1/jobs/{job.id}/book")
    
    assert response.status_code == 409
    assert response.json()["detail"] == "This job is already booked. Nothing to do."

async def test_completed_job_can_be_deleted(client, seed_job, make_job_params):
    job = await seed_job(
        params=make_job_params(),
        status=JobStatus.BOOKING_COMPLETE.value,
    )
    
    response = await client.delete(f"/api/v1/jobs/{job.id}")
    
    assert response.status_code == 204
