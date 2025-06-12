const devices = [
    { name: "Cashier PC", ip: "192.168.1.10" },
    { name: "POS Router", ip: "192.168.1.1" },
    { name: "Owner Laptop", ip: "192.168.1.20" },
    { name: "Guest WiFi AP", ip: "192.168.1.50" },
  ];

  function getPing() {
    return Math.floor(Math.random() * 300); // Simulated ping between 0–299ms
  }

  function getHealthClass(ping) {
    if (ping < 100) return "good";
    if (ping < 200) return "warning";
    return "danger";
  }

  function updateDashboard() {
    const container = document.getElementById("dashboard");
    container.innerHTML = "";

    devices.forEach(device => {
      const ping = getPing();
      const healthClass = getHealthClass(ping);

      const deviceDiv = document.createElement("div");
      deviceDiv.classList.add("device", healthClass);
      deviceDiv.innerHTML = `
        <strong>${device.name}</strong><br />
        IP: ${device.ip} <br />
        Ping: ${ping}ms <br />
        Status: ${
          healthClass === "good"
            ? "✅ Good"
            : healthClass === "warning"
            ? "⚠️ Warning"
            : "❌ At Risk"
        }
      `;
      container.appendChild(deviceDiv);
    });
  }

  updateDashboard(); // initial render
  setInterval(updateDashboard, 5000); // update every 5 seconds