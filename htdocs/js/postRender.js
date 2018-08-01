function modulePostRender(control) {

    control.getControlByPath("sensor/typ").on("change", function () {

        var defaults = {
            "DS18B20": {
                "sensor/path": "temperature",
                "display/typ": "temperature",
                "display/icon": "temperature",
                "display/unit": "temp",
                "data/typ": "abs",
                "advanced/alarm": true
            },
            "DS2423": {
                "sensor/path": "counter.A",
                "display/typ": "meterElectric_pulse_count",
                "display/icon": "meter",
                "display/unit": "",
                "advanced/alarm": false
            }
        };

        var settings = defaults[this.getValue()] || {};

        _.each(settings, function (value, key) {
            var item = this.top().getControlByPath(key);
            if (item !== undefined) {
                item.setValue(value);
            } else {
                console.error("Failed to get control at '" + key + "'");
            }
        }, this);

    });
}

