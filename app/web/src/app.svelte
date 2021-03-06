<script>
  import "bulma/css/bulma.min.css";
  import { onMount } from "svelte";
  import { RadioIcon, RefreshCwIcon } from "svelte-feather-icons";
  import Chart from "./chart.svelte";
  import Breadboard from "./breadboard.svelte";

  const connection = new WebSocket(`ws://${window.location.host}/ws`);

  let baudrate = 19200;
  let portName;
  let ports = [];
  let error = "";
  let version = "";
  let busy = false;
  let connected = false;
  let navbarOpen = false;

  onMount(async () => {
    connection.onopen = onBridgeOpen;
    connection.onclose = () => {
      connected = false;
      error = "";
    };
    connection.onmessage = onMessage;
  });

  async function onMessage({ data }) {
    if (typeof data === "object") {
      const reader = new FileReader();
      reader.addEventListener("loadend", () =>
        serialHook(new Uint8Array(reader.result))
      );
      reader.readAsArrayBuffer(data);
      return;
    }
    const [command, ...params] = data.split(" ");
    switch (command) {
      case "INIT:": {
        version = params[1] || "N/A";
        break;
      }
      case "STATUS:": {
        error = "";
        connected = params[0] === "UP";
        if (connected) {
          navbarOpen = false;
        }
        break;
      }
      case "ERROR:": {
        error = params.join(" ");
        break;
      }
      case "LIST:": {
        portName = params[0];
        ports = params;
        break;
      }
    }
    busy = false;
  }

  function onBridgeOpen() {
    connection.send("INIT");
  }

  function reloadPorts() {
    connection.send("LIST");
  }

  function toggleConnection() {
    if (connection.readyState !== 1) {
      error = "Websocket disconnected";
      return;
    }
    busy = true;
    error = "";
    connected
      ? connection.send("DISCONNECT")
      : connection.send(`CONNECT ${portName} ${baudrate}`);
  }

  function toggleNavbar() {
    navbarOpen = !navbarOpen;
  }

  function serialHook(buffer) {
    new TextDecoder("utf-8")
      .decode(buffer)
      .split("\n")
      .map(console.log);
  }
</script>

<style>
  :global(html),
  :global(body) {
    padding: 0;
    margin: 0;
    min-height: 100%;
  }
  .notification-container {
    position: absolute;
    z-index: 1;
    bottom: 0;
    right: 0;
    padding: 1em;
  }
  .workspace {
    display: flex;
    flex-direction: column;
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
  }
  .workspace .navbar button,
  .workspace .navbar button:focus {
    outline: none;
    border: none;
  }
  .workspace .navbar .navbar-item input {
    max-width: 62px;
  }
</style>

<div class="notification-container">
  {#if error}
    <div class="notification is-danger">{error}</div>
  {/if}
</div>

<div class="workspace">
  <nav class="navbar is-dark">
    <div class="navbar-brand">
      <div class="navbar-item">
        <span class:is-danger={connected}>
          <span class="icon is-small">
            <RadioIcon />
          </span>
          <span class="is-size-4 has-text-weight-bold is-family-code">
            FPGB
          </span>
          <sup class="is-size-7 is-family-code">{version}</sup>
        </span>
      </div>
      <button
        class="navbar-burger burger has-background-dark"
        aria-hidden="true"
        class:is-active={navbarOpen}
        on:click={toggleNavbar}>
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span aria-hidden="true" />
      </button>
    </div>
    <div class="navbar-menu has-background-dark" class:is-active={navbarOpen}>
      <div class="navbar-start" />
      <div class="navbar-end">
        <div class="navbar-item">
          <div class="field has-addons">
            <p class="control">
              <button
                class="button is-small"
                title="Reload"
                on:click={reloadPorts}>
                <span class="icon is-small">
                  <RefreshCwIcon />
                </span>
              </button>
            </p>
            <div class="control">
              <div class="select is-small">
                <select bind:value={portName} disabled={busy || connected}>
                  {#each ports as port}
                    <option value={port}>{port}</option>
                  {/each}
                </select>
              </div>
            </div>
            <p class="control">
              <input
                class="input is-small"
                type="text"
                placeholder="Baudrate"
                bind:value={baudrate}
                disabled={busy || connected} />
            </p>
            <p class="control">
              <button
                class="button is-small"
                class:is-loading={busy}
                class:is-primary={!connected}
                class:is-danger={connected}
                disabled={busy}
                on:click={toggleConnection}>
                {connected ? 'Disconnect' : 'Connect'}
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  </nav>
  <div>
    <Breadboard />
  </div>
</div>
