"""
Run this script to capture a fresh DOC session.
It opens a visible browser, you log in manually, then it saves
the session to the DB.
"""
import asyncio
import json
import sys
import os
import httpx

sys.path.insert(0, os.path.dirname(__file__))

from playwright.async_api import async_playwright

ADAPTER_ID = "doc_great_walk"
API_URL = "http://localhost:8000/api/v1"
START_URL = "https://bookings.doc.govt.nz/Web/Default.aspx"


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=False)
        context = await browser.new_context()
        page = await context.new_page()

        await page.goto(START_URL)

        print("\nLog in manually in the browser window.")
        print("Once you are logged in and can see your account name, press Enter here.\n")
        input()

        state = await context.storage_state()
        await browser.close()

    # POST to API
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{API_URL}/adapters/{ADAPTER_ID}/session",
            json=state,
        )
        print(f"Stored session: {response.status_code} {response.json()}")


if __name__ == "__main__":
    asyncio.run(main())