from app.models import Client, ClientCreate


def test_client_website_is_preserved_in_the_client_api_contract():
    create = ClientCreate(name="Northwind", website="https://northwind.example")
    client = Client(name="Northwind", website=create.website)

    assert create.model_dump()["website"] == "https://northwind.example"
    assert client.model_dump()["website"] == "https://northwind.example"
