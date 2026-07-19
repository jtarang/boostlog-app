def test_register(client):
    res = client.post("/register", json={"email": "testuser@example.com", "password": "testpassword"})
    assert res.status_code == 200
    assert res.json() == {"message": "User registered successfully"}


def test_register_duplicate_email(client):
    client.post("/register", json={"email": "testuser@example.com", "password": "testpassword"})
    res = client.post("/register", json={"email": "testuser@example.com", "password": "testpassword"})
    assert res.status_code == 400
    assert res.json()["detail"] == "Email already registered"


def test_login_by_email(client):
    client.post("/register", json={"email": "testuser@example.com", "password": "testpassword"})
    res = client.post("/token", data={"username": "testuser@example.com", "password": "testpassword"})
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


def test_login_invalid(client):
    client.post("/register", json={"email": "testuser@example.com", "password": "testpassword"})
    res = client.post("/token", data={"username": "testuser@example.com", "password": "wrongpassword"})
    assert res.status_code == 401
