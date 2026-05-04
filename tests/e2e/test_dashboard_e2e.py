from playwright.sync_api import Page, expect
import os

def test_upload_and_visualize(authenticated_page: Page):
    page = authenticated_page
    
    # 1. Upload a dummy CSV
    # Create a dummy CSV file for testing
    csv_path = "tests/e2e/dummy_test.csv"
    os.makedirs("tests/e2e", exist_ok=True)
    with open(csv_path, "w") as f:
        f.write("Time,RPM,Boost,Timing Corr\n0,1000,0,0\n1,2000,10,-1.5\n2,3000,15,-2.0")
    
    # Set the file input
    page.set_input_files("#fileInput", csv_path)
    
    # 2. Verify graph appears
    # Wait for the chart overlay to be hidden (meaning data is loaded)
    expect(page.locator("#chartOverlay")).to_be_hidden()
    expect(page.locator("canvas#mainChart")).to_be_visible()
    
    # 3. Verify metrics are calculated
    expect(page.locator("#valBoost")).not_to_have_text("--")
    expect(page.locator("#valRpm")).to_have_text("3000")
    
    # Clean up
    if os.path.exists(csv_path):
        os.remove(csv_path)

def test_ai_drawer_and_analysis_flow(authenticated_page: Page):
    page = authenticated_page
    
    # 1. Upload file first
    csv_path = "tests/e2e/ai_test.csv"
    with open(csv_path, "w") as f:
        f.write("Time,RPM,Boost\n0,1000,0\n1,2000,10")
    page.set_input_files("#fileInput", csv_path)
    expect(page.locator("#chartOverlay")).to_be_hidden()
    
    # 2. Trigger AI Analysis
    # The FAB AI should be enabled now
    expect(page.locator("#fabAi")).to_be_enabled()
    
    # Open the drawer
    page.locator("#fabAi").click()
    expect(page.locator("#aiDrawer")).to_have_class("ai-drawer open")
    
    # Click analyze in the drawer
    page.locator("#btnAnalyze").click()
    
    # 3. Verify result is rendered (mocked in server-side test, but let's check UI)
    # The marked.js will render the markdown. We look for the text from our mock.
    expect(page.locator(".markdown-body")).to_contain_text("✅ Tuning looks good")
    
    # 4. Verify history pill appears
    expect(page.locator("#historyPills .history-pill")).to_be_visible()
    
    # Clean up
    if os.path.exists(csv_path):
        os.remove(csv_path)

def test_ui_interactions(authenticated_page: Page):
    page = authenticated_page
    
    # 1. Collapsible metrics
    expect(page.locator("#metricsBody")).not_to_have_class("collapsed")
    page.locator(".stats-card .collapsible-header").click()
    expect(page.locator("#metricsBody")).to_have_class("metrics-grid collapsible-body collapsed")
    
    # 2. Parameter filtering
    # Upload something to get toggles
    csv_path = "tests/e2e/filter_test.csv"
    with open(csv_path, "w") as f:
        f.write("Time,RPM,Boost,AFR,OilTemp\n0,1000,0,14.7,90")
    page.set_input_files("#fileInput", csv_path)
    expect(page.locator("#chartOverlay")).to_be_hidden()
    
    # Type in filter
    page.locator("#toggleSearch").fill("Boost")
    # Toggles that don't match should be hidden
    expect(page.locator("label:has-text('AFR')")).to_be_hidden()
    expect(page.locator("label:has-text('Boost')")).to_be_visible()
    
    # Clean up
    if os.path.exists(csv_path):
        os.remove(csv_path)
