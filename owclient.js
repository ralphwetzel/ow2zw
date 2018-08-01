// owfs implementation for z-way-server, loosely based on:
// ... node-owfs: https://github.com/njh/node-owfs
// ... Copyright © 2012-2016 Benedikt Arnold
// ... License MIT @ https://github.com/njh/node-owfs/blob/master/LICENSE.md
// ... Version: 0.3.2.post (17 after commit)

var owClient = (function() {

/*
    var debug = function(message) {
        // args = ["[owclient]"];
        //args.push.apply(arguments);
        debugPrint(argument);
    };
*/

    var _out = function() {

        this.muted = this.muted || false;
        this.buffer = this.buffer || [];

        var arr = ["[ow2zw]"];
        for (var key in arguments) {

            arg = "";
            //format objects automatically
            if (typeof arguments[key] === 'object' && !!arguments[key]) {
                arg = JSON.stringify(arguments[key]);
            } else {
                arg = arguments[key];
            }

            arr.push(arg);
        }

        if (this.muted === true) {
            this.buffer.push(arr.join(" "));
        } else {
            debugPrint(arr.join(" "));
        }
    };

/*    out.mute = function(status) {
        debugPrint(status);
        this.muted = (status === undefined) ? true : status;
    };

    out.dump = function(clear) {
        this.buffer = this.buffer || [];

        l = this.buffer.length;
        for (var i=0; i<l; i++) {
            debugPrint(this.buffer[i]);
        }

        clear = (clear === undefined) ? false : clear;

        if (clear === true) {
            this.buffer = [];
        }
    };*/

    var out = _out;

    // *****
    // ./base/convert.js

    function owData(value, flags) {
        this.value = value;
        this.flags = flags;
    }

    owData.prototype.temperature = function(decimals) {

        if (this.flags & 0x00010000 > 0) {
            return "°F";
        } else if (this.flags & 0x00020000 > 0) {
            return "°K";
        } else if (this.flags & 0x00030000 > 0) {
            return "°R";
        } else {
            return "°C";
        }
    };

    owData.prototype.pressure = function() {
        if (this.flags & 0x00040000 > 0) {
            return "atm";
        } else if (this.flags & 0x00080000 > 0) {
            return "mmHg";
        } else if (this.flags & 0x000C0000 > 0) {
            return "inHg";
        } else if (this.flags & 0x00100000 > 0) {
            return "psi";
        } else if (this.flags & 0x00140000 > 0) {
            return "Pa";
        } else {
            return "mbar";
        }
    };

    owData.prototype.toPressureString = function() {
        return this.value.toString() + " " + this.pressure();
    };

    owData.prototype.toTemperatureString = function() {
        return this.value.toString() + " " + this.temperature();
    };

    var convert = (function() {

        var extractDirectoriesFromMessage = function (message) {
            if (message.payload) {
                if (message.payload.substr(-1) === '\0') {
                    // Remove trailing NULL character
                    message.payload = message.payload.slice(0, -1);
                }
                return message.payload.split(',');
            } else {
                return [];
            }
        };

        return {
            preparePayload: function (payload) {
                if (payload === true) {
                    return '1';
                } else if (payload === false) {
                    return '0';
                } else {
                    return payload.toString();
                }
            },

            extractValue: function (callback) {
                return function (error, messages) {
                    if (!error) {
                        var messageToUse = [];
                        // out(messages);
                        if (messages.length > 1) {
                            out('Received multiple messages in simple read:', messages);

                            messageToUse = messages.filter(function (message) {
                                return  (message.header.payload > 0) &&
                                        (message.header.payload === (message.header.size + 1)) &&
                                        (message.payload && (message.header.payload === message.payload.length));
                            })

                        } else {
                            messageToUse = messages;
                        }

                        if (messageToUse.length < 1) {
                            var err = new Error('No usable messages received.');
                            return callback(err);
                        }

                        mTU = messageToUse[0];
                        if (mTU.payload && mTU.payload.length > 0) {
                            var result = parseFloat(mTU.payload.replace(new RegExp(' ', 'g'), ''));
                            return callback(null, new owData(result, mTU.header.flags));
                        } else {
                            var err = new Error('No payload.');
                            return callback(err);
                        }

                    } else {
                        return callback(error);
                    }
                };
            },

            extractSN: function (callback) {
                return function (error, messages) {
                    if (!error) {
                        var messageToUse = [];
                        // out(messages);
                        if (messages.length > 1) {
                            out('Received multiple messages in simple read:', messages);

                            messageToUse = messages.filter(function (message) {
                                return  (message.header.payload > 0) &&
                                    (message.header.payload === (message.header.size + 1)) &&
                                    (message.payload && (message.header.payload === message.payload.length));
                            })

                        } else {
                            messageToUse = messages;
                        }

                        if (messageToUse.length < 1) {
                            var err = new Error('No usable messages received.');
                            return callback(err);
                        }

                        mTU = messageToUse[0];
                        // payload length === 8 for SN / present
                        if (mTU.payload && mTU.payload.length === 8) {
                            var result = "";
                            for (var i=0; i<8; i++) {
                                result += ('0' + mTU.payload.charCodeAt(i).toString(16)).substr(-2);
                            }
                            // var result = mTU.payload.toString(16);
                            return callback(null, result);
                        } else {
                            // empty string indicating 'not found'.
                            return callback(null, "");
                        }

                    } else {
                        return callback(error);
                    }
                };
            },

            extractDirectories: function (callback) {
                return function (err, messages) {
                    if (!err) {
                        // last item returned from directory call shall be 'null' as End Of List indicator!
                        if (messages.length > 0 && messages[messages.length-1].payload === null) {
                            var directories = messages.map(extractDirectoriesFromMessage);
                            var _ref;
                            return callback(err, (_ref = []).concat.apply(_ref, directories));
                        }
                    } else {
                        return callback(err);
                    }
                }
            }
        };
    })();

    // *****
    // ./base/communication.js

    var communication = (function () {

        // ntohl & htonl from:
        // ... https://github.com/mattcg/network-byte-order
        // ... Copyright © 2010 Membase, Inc.
        // ... License Apache @ https://github.com/mattcg/network-byte-order/blob/master/lib/index.js

        /**
         * Convert a 32-bit quantity (long integer) from host byte order to network byte order (Little-Endian to Big-Endian).
         *
         * @param {Array|Buffer} b Array of octets or a nodejs Buffer
         * @param {number} i Zero-based index at which to write into b
         * @param {number} v Value to convert
         */

        var htonl = function(b, i, v) {
            b[i] = (0xff & (v >> 24));
            b[i + 1] = (0xff & (v >> 16));
            b[i + 2] = (0xff & (v >> 8));
            b[i + 3] = (0xff & (v));
        };

        /**
         * Convert a 32-bit quantity (long integer) from network byte order to host byte order (Big-Endian to Little-Endian).
         *
         * @param {Array|Buffer} b Array of octets or a nodejs Buffer to read value from
         * @param {number} i Zero-based index at which to read from b
         * @returns {number}
         */

        var ntohl = function(b, i) {
            return ((0xff & b[i]) << 24) |
                ((0xff & b[i + 1]) << 16) |
                ((0xff & b[i + 2]) << 8) |
                ((0xff & b[i + 3]));
        };

        var headerProps = ['version', 'payload', 'ret', 'controlflags', 'size', 'offset'];
        var headerLength = 24;
        // var read_buffer = new Uint8Array([]);

        // The values in the flag header are documented here:
        // http://owfs.org/index.php?page=owserver-flag-word
        var flags = {
            fi:         0x01000000,
            fic:        0x05000000,
            request:    0x00000100,
            uncached:   0x00000020,
            safemode:   0x00000010,
            alias:      0x00000008,
            persist:    0x00000004,
            busRet:     0x00000002,
        };

        var sendCommandToSocket = function (options, socket, callback) {

            // socket.messages = [];
            // socket.called = false;
            var read_buffer = new Uint8Array([]);

            var callbackOnce = function (error, data) {
                if (!called) {
                    callback(error, data);
                    called = true;
                    return true;
                }
            };

            socket.onrecv = function(data) {

                // https://gist.github.com/72lions/4528834
                /**
                 * Creates a new Uint8Array based on two different ArrayBuffers
                 *
                 * @private
                 * @param {ArrayBuffer} buffer1 The first buffer.
                 * @param {ArrayBuffer} buffer2 The second buffer.
                 * @return {ArrayBuffer} The new ArrayBuffer created out of the two.
                 */
                var concat = function(buffer1, buffer2) {
                    var tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
                    tmp.set(new Uint8Array(buffer1), 0);
                    tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
                    return tmp.buffer;
                };

                out("Received", data.byteLength, "bytes.");
                read_buffer = new Uint8Array(concat(read_buffer.buffer, data));
            };

            socket.onclose = function(remoteHost, remotePort, localHost, localPort) {

                out("Closing connection to " + remoteHost + ":" + remotePort + ".");

                var messages = [];
                var ret_ok = 0;
                var err = null;

                if (read_buffer.byteLength === 0) {
                    err = new Error('No data received. Timeout? Verify owserver ip & port!')
                }

                while (read_buffer.byteLength >= headerLength) {

                    var header = {};
                    for (var i = 0; i < headerProps.length; i++) {
                        var prop = headerProps[i];
                        header[prop] = ntohl(read_buffer, i * 4)
                    }

                    out("Header:", header);

                    if (header.payload < 0) {
                        read_buffer = new Uint8Array(read_buffer.subarray(headerLength));
                        continue;
                    }

                    // check return value of call
                    ret_ok += header.ret;

                    if (header.ret < 0) {
                        read_buffer = new Uint8Array(read_buffer.subarray(headerLength + header.payload));
                        continue;
                    }

                    if (read_buffer.byteLength >= headerLength + header.payload) {

                        if (header.payload > 0) {
                            var payload = String.fromCharCode.apply(null, read_buffer.subarray(headerLength, headerLength + header.payload));

                            out("Payload:", payload);

                            messages.push({
                                header: header,
                                payload: payload
                            });
                        } else {
                            messages.push({
                                header: header,
                                payload: null
                            });
                        }
                        read_buffer = new Uint8Array(read_buffer.subarray(headerLength + header.payload));
                    } else {
                        break;
                    }
                }

                if (ret_ok < 0 && messages.length === 0) {
                    err = new Error("owserver function call returned ERROR flag!")
                }

                callback(err, messages);
            };

            socket.onconnect = function () {
                out("Sending", options);

                var bodyLength = options.path.length + 1;
                var dataLength = 8192;
                if (options.payload) {
                    dataLength = options.payload.length;
                    bodyLength += dataLength;
                }

                var msg = new Uint8Array(headerLength + bodyLength);
                htonl(msg, 0, 0);
                htonl(msg, 4, bodyLength);
                htonl(msg, 8, options.command);
                // htonl(msg, 12, flags.request | flags.uncached | flags.alias);
                htonl(msg, 12, options.flags === undefined ? (flags.request | flags.alias) : options.flags);
                htonl(msg, 16, dataLength);
                htonl(msg, 20, 0);

                var bytesWritten = headerLength;
                var path_char = [];
                for (var i=0; i<options.path.length; i++) {
                    path_char.push(options.path.charCodeAt(i));
                    // bytesWritten++;
                }
                path_char.push(0);

                msg.set(path_char, bytesWritten);
                bytesWritten += path_char.length;
                if (options.payload) {
                    msg.set(options.payload, bytesWritten)
                }

                socket.send(msg)
            };

            out('Trying to connect to owserver @ ' + options.server + ":" + options.port);
            ret = socket.connect(options.server, options.port);

            if (ret === false) {
                var err = new Error('Failed to connect to owserver @ ' + options.server + ':' + options.port);
                callbackOnce(err, null);
            }
            return ret;
        };

        return {
            sendCommand: function (options, callback) {
                var socket = new sockets.tcp();
                return sendCommandToSocket(options, socket, callback);
            },
            flags: flags
        };
    });


    // *****
    // ./owfs.js

    function owc (server, port, mute) {
        this.server = server;
        this.port = port || 4304;
        this.communication = new communication();

        this.flags = this.communication.flags.request | this.communication.flags.alias;
        //this.flags = 0x108;

        // debug message management!
        this.muted = (mute === undefined) ? false : mute;
        this.buffer = [];

        out = _out.bind(this);
    }

    owc.prototype._dir = function (path, fun, callback) {
        var command = {
            path: path,
            command: fun,
            server: this.server,
            port: this.port,
            flags: this.flags
        };
        return this.communication.sendCommand(command, convert.extractDirectories(callback))
    };

    owc.prototype.read = function (path, callback) {
        var command = {
            path: path,
            command: 2,
            server: this.server,
            port: this.port,
            flags: this.flags
        };
        return this.communication.sendCommand(command, convert.extractValue(callback))
    };

    owc.prototype.write = function (path, payload, callback) {
        var command = {
            path: path,
            command: 3,
            payload: convert.preparePayload(payload),
            server: this.server,
            port: this.port,
            flags: this.flags
        };
        return this.communication.sendCommand(command, callback)
    };

    owc.prototype.present = function (path, callback) {
        var command = {
            path: path,
            command: 6,
            server: this.server,
            port: this.port,
            flags: this.flags
        };
        return this.communication.sendCommand(command, convert.extractSN(callback))
    };

    owc.prototype.dir = function (path, callback) {
        return this._dir(path, 4, callback)
    };

    owc.prototype.dirall = function (path, callback) {
        return this._dir(path, 7, callback)
    };

    owc.prototype.get = function (path, callback) {
        return this._dir(path, 8, callback)
    };

    owc.prototype.dirallslash = function (path, callback) {
        return this._dir(path, 9, callback)
    };

    owc.prototype.getslash = function (path, callback) {
        return this._dir(path, 10, callback)
    };

    owc.prototype.mute = function(status) {
        this.muted = (status === undefined) ? true : status;
    };

    owc.prototype.getFlags = function() {
        return this.flags;
    };

    owc.prototype.setFlags = function(flags) {
        this.flags = flags;
    };

    owc.prototype.dump = function() {

        out.apply(null, arguments);

        l = this.buffer.length;
        for (var i=0; i<l; i++) {
            debugPrint(this.buffer[i]);
        }
        this.buffer = [];
    };

    owc.prototype.clearDebugBuffer = function() {
        this.buffer = [];
    };

    owc.prototype.debug = function() {
        out.apply(null, arguments);
    };

    return owc;

})();
