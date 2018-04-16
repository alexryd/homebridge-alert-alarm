const AlertAlarmApi = require('./api')

module.exports = function(homebridge) {
  const Service = homebridge.hap.Service
  const Characteristic = homebridge.hap.Characteristic

  class AlertAlarmAccessory {
    constructor(platform, device) {
      this.platform = platform
      this.device = device
      this.id = device.radio_code
      this.name = device.name || null
    }

    identify(callback) {
      this.platform.log('AlertAlarmAccessory identified')
      callback()
    }
  }

  class AlertAlarmThermometer extends AlertAlarmAccessory {
    constructor(platform, device) {
      super(platform, device)

      if (!this.name) {
        this.name = this.platform.config.name + ' Thermometer ' + this.id
      }
    }

    getServices() {
      const service = new Service.TemperatureSensor(this.name)

      this.platform.characteristics['temperature-' + this.id] = service
        .getCharacteristic(Characteristic.CurrentTemperature)
        .setProps({ minValue: -100 })

      return [service]
    }
  }

  class AlertAlarmPlatform {
    constructor(log, config) {
      this.log = log
      this.config = config
      this.api = new AlertAlarmApi(config)
      this.lastSeenEventId = 0
      this.characteristics = {}
    }

    accessories(callback) {
      const accessories = []

      this.api.get('/system/devices', { refresh: 'false' })
        .then(res => {
          for (let device of res.body.data) {
            if (device.temperature_measurements) {
              accessories.push(new AlertAlarmThermometer(this, device))
            }
          }

          this.loadEventLog()

          callback(accessories)
        })
        .catch(err => {
          this.log('An error occurred while loading devices')
          throw err
        })
    }

    loadEventLog() {
      this.api.get('/log/recent', { count: 1000, since_id: this.lastSeenEventId })
        .then(res => {
          const characteristics = Object.assign({}, this.characteristics)

          for (let event of res.body.data) {
            if (event.id > this.lastSeenEventId) {
              this.lastSeenEventId = event.id
            }

            if (event.log_type === 'temperature') {
              const key = 'temperature-' + event.data.radio_code
              const characteristic = characteristics[key]

              if (characteristic) {
                characteristic.setValue(event.data.degrees_celsius)
                delete characteristics[key]
              }
            }
          }
        })
        .catch(err => {
          this.log('Failed to load the event log', err)
        })
        .then(() => {
          setTimeout(
            this.loadEventLog.bind(this),
            this.config.refreshInterval || 10 * 60 * 1000
          )
        })
    }
  }

  homebridge.registerPlatform('homebridge-alert-alarm', 'AlertAlarm', AlertAlarmPlatform)
}
