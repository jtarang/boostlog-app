from playwright.sync_api import Page, expect

def test_login_flow(page: Page):
    page.goto("http://127.0.0.1:8001/app")
    
    # Ensure overlay is visible
    expect(page.locator("#authOverlay")).to_be_visible()
    
    # Switch to register
    page.locator(".auth-tabs .tab:nth-child(2)").click() # Assuming child 2 is Register
    
    # Register with email + password (username is auto-derived from the email).
    page.locator("#authEmail").fill("e2e_user@example.com")
    page.locator("#authPassword").fill("e2e_password")
    
    # By clicking register, it should auto-login and hide the overlay based on app.js `handleAuth`
    page.locator("#authSubmitBtn").click()
    
    # Wait for overlay to disappear
    expect(page.locator("#authOverlay")).to_be_hidden()
    
    # Ensure UI loaded by checking for the sidebar or user display
    expect(page.locator(".sidebar")).to_be_visible()
    expect(page.locator("#navUsername")).to_have_text("e2e_user")

def test_login_error_shows(page: Page):
    page.goto("http://127.0.0.1:8001/app")
    
    # Wrong credentials to Login (email is the identity now)
    page.locator("#authEmail").fill("e2e_user@example.com")
    page.locator("#authPassword").fill("wrongpassword")
    page.locator("#authSubmitBtn").click()
    
    # Expect error span to have text
    expect(page.locator("#authError")).not_to_be_empty()
