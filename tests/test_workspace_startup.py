"""A large installed cohort must not be eagerly opened during service startup."""
from neuroimage.cli import main


def test_workspace_serves_before_opening_any_installed_package(tmp_path, monkeypatch):
    import neuroimage.workspace
    import neuroimage.server
    calls = []

    class Workspace:
        def __init__(self, *args, **kwargs):
            self.register_package = lambda path: calls.append(("register", path))

        def package_records(self, **kwargs):
            raise AssertionError("Startup must not walk or prepare the installed cohort")

        def close(self):
            calls.append("workspace-closed")

    class Server:
        server_port = 8765

        def serve_forever(self):
            calls.append("serving")
            assert not any(isinstance(item, tuple) and item[0] == "register" for item in calls)

        def server_close(self):
            calls.append("server-closed")

    def create_server(paths, root, port, *, workspace):
        assert paths == []
        calls.append("server-created")
        return Server()

    monkeypatch.setattr(neuroimage.workspace, "Workspace", Workspace)
    monkeypatch.setattr(neuroimage.server, "create_server", create_server)
    main(["workspace", "--data-root", str(tmp_path / "data"), "--state-root", str(tmp_path / "state"), "--no-browser"])
    assert calls == ["server-created", "serving", "server-closed", "workspace-closed"]
