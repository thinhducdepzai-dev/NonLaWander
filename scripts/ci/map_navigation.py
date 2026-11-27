"""Check Library navigation using local data and a stubbed street-map tile."""
import base64
import os

from playwright.sync_api import expect, sync_playwright

tile = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7AAAAABJRU5ErkJggg=="
)
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=os.getenv("CHROMIUM_PATH"))
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.route("**/tile.openstreetmap.org/**", lambda route: route.fulfill(
        content_type="image/png", body=tile
    ))
    page.goto("http://127.0.0.1:4319/#library?q=ca+phe+dinh&view=map")
    pin = page.locator(".wander-pin").first
    pin.click()
    preview = page.locator("#map-preview")
    expect(preview).to_contain_text("Cà phê Đinh")
    preview.locator("a").click()
    page.wait_for_url("**/#library/dinh-cafe*")
    page.go_back()
    expect(preview).to_be_visible()
    expect(preview).to_contain_text("Cà phê Đinh")
    page.keyboard.press("Escape")
    expect(preview).to_be_hidden()
    page.reload()
    expect(pin).to_be_visible()
    expect(preview).to_be_hidden()
    browser.close()
