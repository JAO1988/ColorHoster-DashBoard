const net = require('net');
const dgram = require('dgram');

// OpenRGB command ID for setting a single LED
const SET_SINGLE_LED = 1052;

class ColorHosterLEDTester {
    constructor(host = '127.0.0.1', port = 6742, protocol = 'tcp') {
        this.host = host;
        this.port = port;
        this.protocol = protocol;
        this.deviceId = 0;
    }

    _buildHeader(commandId, dataBuffer) {
        const header = Buffer.alloc(16);
        header.write('ORGB', 0, 'ascii');
        header.writeUInt32LE(this.deviceId, 4);
        header.writeUInt32LE(commandId, 8);
        header.writeUInt32LE(dataBuffer.length, 12);
        return Buffer.concat([header, dataBuffer]);
    }

    flashLedWhite(ledIndex, flashDurationMs = 500) {
        // Command 1052 structure:
        // LED Index (4 bytes), R (1 byte), G (1 byte), B (1 byte), Padding (1 byte)
        const dataBuffer = Buffer.alloc(8);
        dataBuffer.writeUInt32LE(ledIndex, 0);
        dataBuffer.writeUInt8(255, 4); // Red
        dataBuffer.writeUInt8(255, 5); // Green
        dataBuffer.writeUInt8(255, 6); // Blue
        dataBuffer.writeUInt8(0, 7);   // Padding

        const packet = this._buildHeader(SET_SINGLE_LED, dataBuffer);
        this._sendPacket(packet);

        // Turn off after duration
        setTimeout(() => this.turnOffLed(ledIndex), flashDurationMs);
    }

    turnOffLed(ledIndex) {
        const dataBuffer = Buffer.alloc(8);
        dataBuffer.writeUInt32LE(ledIndex, 0);
        dataBuffer.writeUInt8(0, 4); // Red off
        dataBuffer.writeUInt8(0, 5); // Green off
        dataBuffer.writeUInt8(0, 6); // Blue off
        dataBuffer.writeUInt8(0, 7); // Padding

        const packet = this._buildHeader(SET_SINGLE_LED, dataBuffer);
        this._sendPacket(packet);
    }

    _sendPacket(packetBuffer) {
        if (this.protocol === 'tcp') {
            const client = new net.Socket();
            client.connect(this.port, this.host, () => {
                client.write(packetBuffer);
                client.end();
            });
            client.on('error', (err) => console.error('TCP Error:', err.message));
        } else {
            const client = dgram.createSocket('udp4');
            client.send(packetBuffer, this.port, this.host, () => client.close());
            client.on('error', (err) => console.error('UDP Error:', err.message));
        }
    }
}

module.exports = ColorHosterLEDTester;
