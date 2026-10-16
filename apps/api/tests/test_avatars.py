import base64


def test_avatar_look(owner):
    assert owner.put("/api/staff/support/avatar", json={"color": "red"}).status_code == 400
    assert owner.put("/api/staff/support/avatar", json={"prop": "rocket"}).status_code == 400
    r = owner.put("/api/staff/support/avatar", json={"color": "#8b5cf6", "prop": "headset", "shape": "bean"})
    assert r.status_code == 200 and r.json()["support"] == {"color": "#8b5cf6", "shape": "bean", "prop": "headset"}
    svg = owner.post("/api/files", json={"name": "x.svg", "data": base64.b64encode(b"<svg/>").decode()}).json()
    assert owner.put("/api/staff/support/avatar", json={"image": svg["id"]}).status_code == 400, "no SVG pictures (script risk)"
    png = owner.post("/api/files", json={"name": "me.png", "data": base64.b64encode(b"\x89PNG\r\n\x1a\n").decode()}).json()
    assert owner.put("/api/staff/support/avatar", json={"image": png["id"]}).json()["support"]["image"] == png["id"]
    assert "support" not in owner.put("/api/staff/support/avatar", json={}).json()
    assert owner.put("/api/staff/nobody/avatar", json={}).status_code == 404
