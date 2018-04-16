const jwt = require('jsonwebtoken')
const superagent = require('superagent')

const BASE_URL = 'https://api.alertalarm.se'
const USER_AGENT = 'AlertAlarm/2.46.4-release(5) (iOS 11.3 15E216, iPhone9,3)'

class AlertAlarmApi {
  constructor(config = null) {
    this.config = config
    this._token = null
    this._tokenExpiresAt = 0

    for (let method of ['get', 'post', 'put']) {
      this[method] = (uri, data = null) => {
        return this.request(method, uri, data)
      }
    }
  }

  request(method, uri, data) {
    const req = superagent[method](BASE_URL + uri)
    req.accept('*/*')
    req.set('User-Agent', USER_AGENT)
    req.set('Accept-Language', 'sv-SE')

    const token = this.getToken()
    if (token) {
      req.set('Authorization', `Bearer ${token}`)
    }

    if (data) {
      if (method === 'get') {
        req.query(data)
      } else {
        req.type('json')
        req.send(data)
      }
    }

    return req
  }

  getToken() {
    const now = Math.floor(Date.now() / 1000)
    if (this._token && this._tokenExpiresAt > now + 10) {
      return this._token
    }

    const config = this.config
    if (!config || !config.privateKey || !config.clientId || !config.systemId) {
      return null
    }

    const expiresAt = this._tokenExpiresAt = now + 300
    const payload = {
      iss: config.clientId,
      sub: config.systemId,
      iat: now,
      exp: expiresAt,
    }
    this._token = jwt.sign(payload, config.privateKey, { algorithm: 'RS256' })

    return this._token
  }
}

module.exports = AlertAlarmApi
