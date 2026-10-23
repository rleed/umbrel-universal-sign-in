const { parseArgs } = require('node:util')
const fs = require('fs')
const path = require('path')
const express = require('express')
const { exec } = require("child_process")
const bm = require('bitcoinjs-message')
const bl = require('bitcoinjs-lib')
const z32 = require('z32')
const qrlib = require('qrcode')
const { Verifier } = require('bip322-js')
const { bech32 } = require('bech32')
const { schnorr } = require('@noble/curves/secp256k1')
const jwt = require('jsonwebtoken')
const cookieParser = require('cookie-parser')
const { randomBytes } = require('node:crypto');

import('lowdb/node').then(lowdb_node => {
  JSONFile = lowdb_node.JSONFile
import('lowdb').then(lowdb => {
  Low = lowdb.Low
import('@nostr/tools/pure').then(nostr_tools_pure => {
  const { getEventHash } = nostr_tools_pure
import('@noble/secp256k1').then(secp => {
import('@noble/hashes/sha2.js').then(hashes => {
  secp.hashes.sha256 = hashes.sha256

const options = {
  port: {
    type: 'string',
    short: 'p',
    default: '8066',
  },
  datapath: {
    type: 'string',
    short: 'd',
    default: '',
  },
  domains: {
    type: 'string',
    short: 'o',
    default: '[]',
  },
  mattermost: {
    type: 'string',
    short: 'i',
    default: 'https://my.mattermost.instance',
  },
  token: {
    type: 'string',
    short: 't',
  },
  route: {
    type: 'string',
    short: 'r',
    default: '/sign-in'
  },
  session: {
    type: 'string',
    short: 's',
    default: '/api/v1/session'
  },
  admin: {
    type: 'string',
    short: 'a',
    default: '/'
  },
  team: {
    type: 'string',
    short: 'w',
    default: 'welcome',
  },
  message: {
    type: 'string',
    short: 'M',
    default: `\
I ({idhash}), the undersigned, hereby access {domain} as of {blocktime} ({blockhash}) \
subject to the terms and policies.`
  },
}

const MEMPOOL = process.env.DNC_US_MEMPOOL_API || 'https://mempool.guide/api'
const MEMPOOL2 = process.env.DNC_US_ALT_MEMPOOL_API || 'https://mempool.space/api'

const seen = []
const seen2 = []

const { values: opts, positionals: args } = parseArgs({
  options,
  allowPositionals: true,
})

const adapter1 = new JSONFile(`${opts.datapath}users.json`)
const users_db = new Low(adapter1, {})
users_db.read()
const adapter2 = new JSONFile(`${opts.datapath}activity.json`)
const activity_db = new Low(adapter2, [])
activity_db.read()
const adapter3 = new JSONFile(`${opts.datapath}permissions.json`)
const permissions_db = new Low(adapter3, {})
permissions_db.read()

let team_id = undefined

var app = express()
var app_options = {}
app.set('trust proxy', true)
app.use(cookieParser())


function base64ToBytes(base64) {
  const binString = Buffer.from(base64, 'base64').toString('utf8');
  return Uint8Array.from(binString, (m) => m.codePointAt(0));
}

app.get(`${opts.route}/qr`, (req, res) => {
  const text = req.query.text || 'Hello World'
  try {
    qrlib.toDataURL(text).then(qrDataUrl => {
      res.send(`<img src="${qrDataUrl}" alt="QR Code">`)
    }).catch(e => {
      console.log(`error generating data URL: ${e}`)
      res.status(500).end()
    })
  } catch (e) {
    console.log(`error generating QR code: ${e}`)
    res.status(500).end()
  }
})

const get_options = {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${opts.token}`,
    'Accept': 'application/json'
  }
}
const post_options = {
  method: 'POST',
  credentials: 'include',
  headers: {
    'X-Requested-With': 'XMLHttpRequest',
    'Authorization': `Bearer ${opts.token}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  }
}


function loginMattermost(res, id) {
  const injectSession = (username) => {
    return new Promise((resolve, reject) => {
      //console.log(`getting session token for ${username}`)
      fetch(`${opts.mattermost}/api/v4/users/login`, { ...post_options, body: JSON.stringify({
        login_id: username,
        password: process.env.HARD_PASS,
      })}).then(r => {
        const setCookieHeaders = r.headers.getSetCookie()
        const cookies = {};
        for (const cookieString of setCookieHeaders) {
          const [keyValuePair, ...attributes] = cookieString.split(';')
          const [key, value] = keyValuePair.split('=').map(s => s.trim())
          if (key && value) {
            cookies[key] = value
          }
        }
        //console.log(`injecting session cookies for ${username}: ${JSON.stringify(cookies)}`)
        res.cookie('MMUSERID',    cookies['MMUSERID'],    { maxAge: 30*24*60*60*1000, secure: true })
        res.cookie('MMCSRF',      cookies['MMCSRF'],      { maxAge: 30*24*60*60*1000, secure: true })
        res.cookie('MMAUTHTOKEN', cookies['MMAUTHTOKEN'], { maxAge: 30*24*60*60*1000, secure: true })
        resolve()
      })
    })
  }
  return new Promise((resolve, reject) => {
    const hash = Buffer.from(hashes.sha256(new TextEncoder().encode(id)))
    const l = hash.length/4
    let a = ''
    for (i=0; i<l; i++) {
      let b = hash[i] ^ hash[i+l] ^ hash[i+l*2] ^ hash[i+l*3]
      a += ('0'+b.toString(16)).slice(-2)
    }
    a = a.split('').map(c => String.fromCharCode(c.charCodeAt(0) + (/\d/.test(c)? 97-48: 10))).join('')
    const shortcode = a

    let user_id = users_db.data[id]
    if (!user_id) {

      // create new user
      console.log(`creating new user account ${shortcode}`)
      fetch(`${opts.mattermost}/api/v4/users`, { ...post_options, body: JSON.stringify({
        username: shortcode,
        password: process.env.HARD_PASS,
        email: `${shortcode}@satoshidnc.com`
      })}).then(r => r.json()).then(json => {
        if (json.email == `${shortcode}@satoshidnc.com` && json.id) {
          user_id = json.id
          users_db.data[id] = user_id
          users_db.write().then(()=>{}).catch(e => console.log(`error writing db: ${e}`))

          // add user to team
          const addToTeam = () => {
            fetch(`${opts.mattermost}/api/v4/teams/${team_id}/members`, { ...post_options, body: JSON.stringify({
              team_id: team_id,
              user_id: user_id
            })}).then(r => r.json()).then(json => {
              if (json.team_id == team_id && json.user_id == user_id) {
                // log in
                injectSession(shortcode).then(() => {
                  resolve({
                    id: user_id
                  })
                })
              } else {
                reject(`error adding user to team: ${JSON.stringify(json)}`)
              }
            })
          }
          // find team
          if (!team_id) {
            fetch(`${opts.mattermost}/api/v4/teams/name/${opts.team}`, get_options).then(r => r.json()).then(json => {
              if (json.name == opts.team && json.id) {
                team_id = json.id
                addToTeam()
              } else {
                reject(`error finding team: ${JSON.stringify(json)}`)
              }
            })
          } else {
            addToTeam()
          }
        } else {
          reject(`error creating account ${shortcode}: ${JSON.stringify(json)}`)
        }
      })

    } else {
      fetch(`${opts.mattermost}/api/v4/users/${user_id}`, get_options).then(r => r.json()).then(json => {
        if (json.id == user_id) {
          injectSession(json.username).then(() => {
            resolve({
              id: json.id
            })
          })
        } else {
          console.log(`error querying mattermost user ${user_id}`)
          reject(JSON.stringify(json))
        }
      }).catch(e => { reject(e) })

    }
  })
}


function verifyNostorEvent(npub, messageString, sig, ...aux) {
//console.log('args:', npub, messageString, sig, aux)
  return new Promise((resolve, reject) => {
    try {
      const decoded = bech32.decode(npub)
      if (!decoded || decoded.prefix != 'npub') {
        resolve(false)
        return
      }
      const bytes = bech32.fromWords(decoded.words)
      let pubkey
      if (bytes.length == 32 && bytes.reduce((a,c) => a && c>=0 && c<256, true)) {
        pubkey = bytes.map(x => (x.toString(16)).padStart(2,'0')).join('')
      } else {
        resolve(false)
        return
      }

      const event = {
        pubkey: `${pubkey}`,
        created_at: +aux[5],
        kind: 1,
        tags: [
        ],
        content: `${messageString}`
      }
//console.log('event', JSON.stringify(event))
      const hexToBytes = hex => new Uint8Array(hex.split(/(?=(?:..)*$)/).map(e => parseInt(e, 16)))
      const id = getEventHash(event)
      const valid = schnorr.verify(
        hexToBytes(sig),
        hexToBytes(id),
        hexToBytes(pubkey))
      resolve(valid)
      return
    } catch(e) {
      resolve(false)
      return
    }
  })
}


function verifyLightningMessage(pubkeyHex, messageString, zbase32Signature) {
  return new Promise((resolve, reject) => {
    try {
      valid = secp.verify(
        z32.decode(zbase32Signature).slice(1),
        hashes.sha256(new TextEncoder().encode('Lightning Signed Message:'+messageString)),
        Buffer.from(pubkeyHex, 'hex'))
      resolve(valid)
    } catch (e) {
      //console.error(e)
      resolve(false)
    }
  })
}


function verify(id, message, sig, ...aux) {
  return new Promise((resolve, reject) => {

    // check for valid lightning signed message
    let pubkey = id
    atSign = id.indexOf('@')
    if (atSign !== -1) {
      pubkey = pubkey.slice(0, atSign)
    }
    verifyLightningMessage(pubkey, message, sig).then(valid => {
      if (valid) {
        resolve({
          scheme: 'Lightning Signed Message',
          loginId: pubkey,
          message,
          sig
        })
      } else {

        // check for valid bitcoin signed message
        try {
          valid = bm.verify(message, id, sig, null, true)
        } catch (e) {
        }
        if (valid) {
          resolve({
            scheme: 'Bitcoin Signed Message',
            loginId: id,
            message,
            sig
          })
        } else {

          // check for BIP-322 signed message
          try {
            valid = Verifier.verifySignature(id, message, sig)
          } catch(e) {
          }
          if (valid) {
            resolve({
              scheme: 'BIP-322 Signed Message',
              loginId: id,
              message,
              sig
            })
          } else {

            // check for Nostor signed event
            verifyNostorEvent(id, message, sig, ...aux).then(valid => {
              if (valid) {
                resolve({
                  scheme: 'Nostor Signed Message',
                  loginId: id,
                  message,
                  sig
                })
              } else {

                // all attempts failed
                reject('not valid according to any supported signature scheme')

              }
            })
          }
        }
      }
    })
  })
}



app.get(opts.session, function (req, res) {
  const origin = req.headers['origin']
  if (!origin.startsWith('https://')) {
    console.log(`protocol rejected: ${origin}`)
    res.status(503).send('{"error":"HTTPS is required."}')
    return
  }
  const domain = origin.toLowerCase().replace(/^https:\/\//, '')
  const allowed_domains = JSON.parse(opts.domains)
  if (!allowed_domains.includes(domain)) {
    console.log(`domain rejected: ${origin}`)
    res.status(503).send('{"error":"The origin domain is not allowed to access this resource."}')
    return
  }

  res.set('Access-Control-Allow-Origin', `${origin}`)
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.set('Access-Control-Allow-Credentials', 'true')

  const url1 = `${MEMPOOL}/blocks/tip/hash`
  fetch(url1).then(r => r.text()).then(text => {
    const hash = text
    if (!/[0-9a-fA-F]{64}/.test(text)) {
      console.error(`error getting chain tip: ${text}: ${url1}`)
      res.status(200).send('{"error":"The blockchain service is unavailable: please inform the administrator."}')
      return
    }

    const url2 = `${MEMPOOL}/block/${hash}`
    fetch(url2).then(r => r.json()).then(block => {
      if (!block.height) {
        console.error(`error getting tip block: ${hash}: ${url2}`)
        res.status(200).send('{"error":"The blockchain service is unavailable: please inform the administrator."}')
        return
      }

      const loginId      = req.query.id
      const loginSig     = req.query.sig
      const logout       = req.query.logout

      /* requires signins permission */
      const readSignins  = req.query.signins

      /* requires pos permission */
      const prepReceive  = req.query.receive
      const checkAddress = req.query.addr
      const checkAmount  = req.query.amt
      const checkHeight  = req.query.h

      const usstoken = req.cookies.usstoken

      successHandler = payload => {
        const data = {
          payload,
          chaintip: block.height,
          minihash: hash.substr(hash.length-4),
        }
        if (readSignins && permissions_db.data['signins']?.includes(payload.id)) {
          data.signins = activity_db.data.map(r => { return {
            date: r.date,
            scheme: r.scheme,
            id: r.id,
          } })
        }
        if (prepReceive && permissions_db.data['pos']?.includes(payload.id)) {
          data.pyg = 4.7
          data.addresses = []
          if (process.env.DNC_US_FALLBACK_RECV_ADDR) {
            data.addresses.push(process.env.DNC_US_FALLBACK_RECV_ADDR)
          }
        }
        const finish = () => {
          //const tagHash = Buffer.from(hashes.sha256(Uint8Array.from(Buffer.from(process.env.DNC_US_USER_PRIVACY_TAG, 'utf8'))))
          //const userId = Buffer.from(data.payload.id, 'hex')
          //const obfsId = Buffer.from(hashes.sha256(Buffer.concat([tagHash, tagHash, userId]))).toString('hex')
          //data.payload.id = obfsId
          res.status(200).send(JSON.stringify(data))
        }
        if (checkAddress && permissions_db.data['pos']?.includes(payload.id)) {
          fetch(`${MEMPOOL}/address/${checkAddress}/utxo`).then(r => r.json()).then(json => {
            const utxos = json.filter(utxo => {
              return utxo.value == checkAmount
                && (!seen.includes(utxo.txid))
                && (utxo.status.confirmed == false
                 || utxo.status.block_height > checkHeight)
            })
            if (utxos.length > 0) {
              seen = seen.filter(utxo => utxo.status.confirmed == false
                                      || utxo.status.block_height <= checkHeight)
              seen.push(...utxos)
              console.log(utxos, seen)
              data.paid = true
              finish()
            } else {
              fetch(`${MEMPOOL2}/address/${checkAddress}/utxo`).then(r => r.json()).then(json => {
                const utxos = json.filter(utxo => {
                  return utxo.value == checkAmount
                    && (!seen2.includes(utxo.txid))
                    && (utxo.status.confirmed == false
                     || utxo.status.block_height > checkHeight)
                })
                if (utxos.length > 0) {
                  seen2 = seen2.filter(utxo => utxo.status.confirmed == false
                                            || utxo.status.block_height <= checkHeight)
                  seen2.push(...utxos)
                  console.log(Date.now(), 'centralized', utxos, seen2)
                  data.paid = true
                } else {
                  data.paid = false
                }
                finish()
                setTimeout(() => {
                  console.log(Date.now(), `following up on centralized utxo`)
                }, 60 * 1000)
              })
            }
          })
        } else {
          finish()
        }
      }

      let existingPayload
      if (usstoken) {
        try {
          existingPayload = jwt.verify(usstoken, process.env.DNC_US_SECRET)
        } catch (e) {
          existingPayload = undefined
          console.error('Token verification failed:', e.message);
          res.status(200).send('{"error":"Invalid session token."}')
          return
        }
        if (!existingPayload?.t) {
          console.error('Token is missing t:', existingPayload);
          res.status(200).send('{"error":"Invalid session token."}')
          return
        }
        if (!existingPayload?.id) {
          console.error('Token is missing id:', existingPayload);
          res.status(200).send('{"error":"Invalid session token."}')
          return
        }
      }
      if (!loginId && !loginSig && !logout && existingPayload) {
        successHandler(existingPayload)
        return
      }

      const finisher = (t, id, sig, match) => {
        const newPayload = {
          t,
          id,
          form_of_id: match?.scheme,
        }
        if (id && sig && match) {
          console.log(`successful login by ${match.loginId}`)
          Object.keys(permissions_db.data).forEach(key => {
            if (permissions_db.data[key].includes(id)) {
              newPayload[`acl_${key}`] = true
            }
          })
          activity_db.data.push({
            date: Date.now(),
            status: 'success',
            presented: loginId,
            scheme: match.scheme,
            id: match.loginId,
            message: match.message,
            template: opts.message,
            sig: match.sig,
          })
          activity_db.write().then(()=>{}).catch(e => console.log(`error writing db: ${e}`))
        }
        const options = { expiresIn: '30d' }
        const token = jwt.sign(newPayload, process.env.DNC_US_SECRET, options)
        res.set('Set-Cookie', `usstoken=${token}; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict`)
        successHandler(newPayload)
      }
      const b = block.height
      const y = Math.floor(b / 52500)
      const yb = b % 52500
      const ym = Math.floor(yb / 4375)
      const ymb = yb % 4375
      const ymd = Math.floor(ymb / 144)
      const ymdb = ymb % 144
      const th = Math.floor(ymdb / 6)
      const thb = ymdb % 6
      const tm = thb * 10
      const blocktime = `${String(th).padStart(2,'0')}:${String(tm).padStart(2,'0')} ${String(ymd+1).padStart(2,'0')}/${String(ym+1).padStart(2,'0')}/${String(y+1).padStart(4,'0')} BTC`
      const blockhash = hash.slice(-4)
      const randomid = randomBytes(32).toString('hex')
      let idhash = existingPayload?.id || randomid
//      {
//        const tagHash = Buffer.from(hashes.sha256(Uint8Array.from(Buffer.from(process.env.DNC_US_USER_PRIVACY_TAG, 'utf8'))))
//        const userId = Buffer.from(randomid, 'hex')
//        const obfsId = Buffer.from(hashes.sha256(Buffer.concat([tagHash, tagHash, userId]))).toString('hex')
//        idhash = obfsId
//      }
      const template = opts.message
      const message = template
        .replaceAll('{idhash}', idhash.slice(-4))
        .replaceAll('{domain}', domain)
        .replaceAll('{blocktime}', blocktime)
        .replaceAll('{blockhash}', blockhash)
      const timestamp = block.timestamp
      let id, sig
      if (logout) {
        finisher(b, randomid, undefined, undefined)
      } else if (loginId || loginSig) {
        idhash = existingPayload?.id || loginId
//        {
//          const tagHash = Buffer.from(hashes.sha256(Uint8Array.from(Buffer.from(process.env.DNC_US_USER_PRIVACY_TAG, 'utf8'))))
//          const userId = Buffer.from(loginId, 'hex')
//          const obfsId = Buffer.from(hashes.sha256(Buffer.concat([tagHash, tagHash, userId]))).toString('hex')
//          idhash = obfsId
//        }
        verify(loginId, message, loginSig,
          template, idhash, domain, blocktime, blockhash, timestamp
        ).then(match => {
          console.log(`received ${match.scheme} by ${match.loginId} declaring: ${message}`)
          const date_now = Date.now()
          const prevTemplate = activity_db.data.reduce((a, c) => {
            let age = date_now - c.date
            if (['success', 'new-terms'].includes(c.status) && !isNaN(c.date) && c.template && (!a.age || age < a.age)) {
              return { age, template: c.template }
            } else {
              return a
            }
          }, { age: 0, template: '' }).template
          const prevTemplateFilled = prevTemplate
            .replaceAll('{idhash}', idhash.slice(-4))
            .replaceAll('{domain}', domain)
            .replaceAll('{blocktime}', blocktime)
            .replaceAll('{blockhash}', blockhash)
          if (false) { // if (prevTemplateFilled != message) {
            console.log(`terms changed for ${loginId}`)
            console.log(`old: ${prevTemplateFilled}`)
            console.log(`new: ${message}`)
            res.redirect(`${opts.route}?signinfo=The+sign-in+message+has+changed+since+you+last+signed+in.+Please+re-read+it+carefully+before+proceeding.`)
            activity_db.data.push({
              date: Date.now(),
              status: 'new-terms',
              presented: loginId,
              scheme: match.scheme,
              id: match.loginId,
              message: match.message,
              template: template,
              sig: match.sig
            })
            activity_db.write().then(()=>{}).catch(e => console.log(`error writing db: ${e}`))
          } else {
            let screenUser = new Promise((resolve, reject) => {
              resolve()
            })
/*
            if (match.scheme == 'Bitcoin Signed Message') {
              screenUser = new Promise((resolve, reject) => {
                fetch(`${MEMPOOL}/address/${loginId}/txs`).then(r => r.json()).then(json => {
                  txs = json
                  if (txs.length == 0) {
                    reject('Bitcoin address not found on blockchain: use another.')
                  } else {
                    resolve()
                  }
                })
              })
            }
*/
            screenUser.then(() => {
              finisher(b, loginId, loginSig, match)
            }).catch(e => {
              console.log(`blocked ${match.loginId}: ${e}`)
              activity_db.data.push({
                date: Date.now(),
                status: 'blocked',
                presented: loginId,
                scheme: match.scheme,
                id: match.loginId,
                message: match.message,
                template: template,
                sig: match.sig,
              })
              activity_db.write().then(()=>{}).catch(e => console.log(`error writing db: ${e}`))
              console.error(`blocked user: ${e}`)
              res.status(200).send(`{"error":"Access denied: ${e}"}`)
              return
            })
          }
        }).catch(e => {
          console.log(`signature verification failed for ${loginId}: ${e}`)
          console.log(`expected message: ${message}`)
          res.status(200).send(`{"error":"Improperly signed: try again."}`)
        })
      } else {
        finisher(b, randomid, undefined, undefined)
      }
    }).catch(e => {
      console.error(`error getting block: ${e}: ${url2}`)
      res.status(200).send(`{"error":"Unable to get block: ${url2}"}`)
    })
  }).catch(e => {
    console.error(`error getting blockchain tip: ${e}: ${url1}`)
    res.status(200).send(`{"error":"Unable to get blockchain tip: ${url1}"}`)
  })

})

app.get(opts.route, function (req, res) {
console.log(`c`)

  // sanity check domain name
  const proto = req.protocol
  const domain = req.get('host')
  if (`https://${domain}` != opts.mattermost) {
    console.log(`domain mismatch: https://${domain} vs ${opts.mattermost}`)
    res.redirect(opts.mattermost)
    return
  }

  // establish block time
  fetch(`${MEMPOOL}/blocks/tip/hash`).then(r => r.text()).then(text => {

    const hash = text
    if (!/[0-9a-f]/.test(hash)) {
      console.log(`error getting block tip: ${text}`)
      res.status(503).send('The mempool service is unavailable: please inform the administrator.')
      return
    }

    fetch(`${MEMPOOL}/block/${hash}`).then(r => r.json()).then(block => {
      const b = block.height
      const y = Math.floor(b / 52500)
      const yb = b % 52500
      const ym = Math.floor(yb / 4375)
      const ymb = yb % 4375
      const ymd = Math.floor(ymb / 144)
      const ymdb = ymb % 144
      const th = Math.floor(ymdb / 6)
      const thb = ymdb % 6
      const tm = thb * 10
      const blocktime = `${String(th).padStart(2,'0')}:${String(tm).padStart(2,'0')} ${String(ymd+1).padStart(2,'0')}/${String(ym+1).padStart(2,'0')}/${String(y+1).padStart(4,'0')} BTC`
      const blockhash = hash.slice(-4)
      const randomid = randomBytes(32).toString('hex')
      let idhash = randomid
//      {
//        const tagHash = Buffer.from(hashes.sha256(Uint8Array.from(Buffer.from(process.env.DNC_US_USER_PRIVACY_TAG, 'utf8'))))
//        const userId = Buffer.from(randomid, 'hex')
//        const obfsId = Buffer.from(hashes.sha256(Buffer.concat([tagHash, tagHash, userId]))).toString('hex')
//        idhash = obfsId
//      }
      const template = opts.message
      const message = template
        .replaceAll('{idhash}', idhash.slice(-4))
        .replaceAll('{domain}', domain)
        .replaceAll('{blocktime}', blocktime)
        .replaceAll('{blockhash}', blockhash)
      const timestamp = block.timestamp
      //const message = `I hereby request access to ${domain} at ${time} (${hash.slice(-4)}) subject to the terms and policies then on file.`

      // show modified login page
      if (JSON.stringify(Object.fromEntries(Object.entries(req.query).filter(([k]) => k !== 'signerror'))) == '{}') {
        let content = fs.readFileSync(path.join(__dirname, 'login-page.html'), 'utf8')
        let messageSnippet = fs.readFileSync(path.join(__dirname, 'error-snippet.html'), 'utf8')
        content = content.replaceAll('{base_url}', `${proto}://${domain}`)
        content = content.replaceAll('{message}', message)
        content = content.replaceAll('{error_slot}', (!req.query.signerror)?'':messageSnippet.replaceAll('{message}', req.query.signerror))
        res.send(content)
        res.end()
      } else if (JSON.stringify(Object.fromEntries(Object.entries(req.query).filter(([k]) => k !== 'signinfo'))) == '{}') {
        let content = fs.readFileSync(path.join(__dirname, 'login-page.html'), 'utf8')
        let messageSnippet = fs.readFileSync(path.join(__dirname, 'info-snippet.html'), 'utf8')
        content = content.replaceAll('{base_url}', `${proto}://${domain}`)
        content = content.replaceAll('{message}', message)
        content = content.replaceAll('{error_slot}', (!req.query.signinfo)?'':messageSnippet.replaceAll('{message}', req.query.signinfo))
        res.send(content)
        res.end()
      } else {

        // perform modified login procedure
        const loginMessage = req.query.loginMessage
        const loginId      = req.query.loginId
        const loginSig     = req.query.loginSig
        if (loginMessage != message) {
          console.log(`failed login by ${loginId}`)
          console.log(`presented: ${loginMessage}`)
          console.log(`expected: ${message}`)
          res.redirect(`${opts.route}?signerror=Login+message+expired:+try+again.`)
        } else {
          verify(loginId, loginMessage, loginSig,
            template, undefined, domain, blocktime, blockhash, timestamp
          ).then(match => {
            console.log(`received ${match.scheme} by ${match.loginId}`)
            const date_now = Date.now()
            const prevTemplate = activity_db.data.reduce((a, c) => {
              let age = date_now - c.date
              if (['success', 'new-terms'].includes(c.status) && !isNaN(c.date) && c.template && (!a.age || age < a.age)) {
                return { age, template: c.template }
              } else {
                return a
              }
            }, { age: 0, template: '' }).template
            const prevTemplateFilled = prevTemplate
              .replaceAll('{idhash}', idhash.slice(-4))
              .replaceAll('{domain}', domain)
              .replaceAll('{blocktime}', blocktime)
              .replaceAll('{blockhash}', blockhash)
            if (false) { // if (prevTemplateFilled != message) {
              console.log(`terms changed for ${loginId}`)
              console.log(`old: ${prevTemplateFilled}`)
              console.log(`new: ${message}`)
              res.redirect(`${opts.route}?signinfo=The+sign-in+message+has+changed+since+you+last+signed+in.+Please+re-read+it+carefully+before+proceeding.`)
              activity_db.data.push({
                date: Date.now(),
                status: 'new-terms',
                presented: loginId,
                scheme: match.scheme,
                id: match.loginId,
                message: match.message,
                template: template,
                sig: match.sig
              })
              activity_db.write().then(()=>{}).catch(e => console.log(`error writing db: ${e}`))
            } else {
            let screenUser = new Promise((resolve, reject) => {
              resolve()
            })
/*
            if (match.scheme == 'Bitcoin Signed Message') {
              screenUser = new Promise((resolve, reject) => {
                fetch(`${MEMPOOL}/address/${loginId}/txs`).then(r => r.json()).then(json => {
                  txs = json
                  if (txs.length == 0) {
                    reject('Bitcoin address not found on blockchain: use another.')
                  } else {
                    resolve()
                  }
                })
              })
            }
*/
            screenUser.then(() => {
              loginMattermost(res, match.loginId).then(detail => {
                console.log(`successful login by ${match.loginId}`)
                res.redirect('/')
                activity_db.data.push({
                  date: Date.now(),
                  status: 'success',
                  presented: loginId,
                  scheme: match.scheme,
                  id: match.loginId,
                  message: match.message,
                  template: template,
                  sig: match.sig,
                  user: detail.id
                })
                activity_db.write().then(()=>{}).catch(e => console.log(`error writing db: ${e}`))
              }).catch(e => {
                console.log(`failed to login ${match.loginId}: ${e}`)
                res.redirect(`${opts.route}?signerror=${encodeURIComponent('Unexpected error: please report date/time of incident to admin.')}`)
              })
            }).catch(e => {
              console.log(`blocked ${match.loginId}: ${e}`)
              activity_db.data.push({
                date: Date.now(),
                status: 'blocked',
                presented: loginId,
                scheme: match.scheme,
                id: match.loginId,
                message: match.message,
                template: template,
                sig: match.sig,
              })
              activity_db.write().then(()=>{}).catch(e => console.log(`error writing db: ${e}`))
              res.redirect(`${opts.route}?signerror=${encodeURIComponent(e)}`)
            })
            }
          }).catch(e => {
            console.log(`signature verification failed for ${loginId}: ${e}`)
            res.redirect(`${opts.route}?signerror=${encodeURIComponent('Improperly signed: try again.')}`)
          })
        }
      }
    })
  })
})


// intended as admin panel behind umbrel login
app.get(`${opts.admin}`, function (req, res) {

  const proto = req.protocol
  const domain = req.get('host')

  // tablulate results
  let users = undefined
  const getResults = () => {
    console.log(activity_db.data.map(e => e.id))
    console.log([...new Set(activity_db.data.map(e => e.id))])
    let rows = [...new Set(activity_db.data.map(e => e.id))].map(id => {
      const latest = activity_db.data.reduce((a,c) => {
        if (c.id == id && c.status == 'success') {
          if (a.scheme == '' || a.time < c.time) {
            return c
          } else {
            return a
          }
        } else {
          return a
        }
      }, { scheme: '', time: '' })
      console.log(id, latest)
      const u = latest //users?.filter(u => u.id == activity_db.data[id])[0]
      return `<td>${new Date(u.date).toLocaleString()}</td><td>${u.scheme}</td><td>${u.presented||id}</td>`
    })
    let table = '<table class="guests"><tr><th>Date</th><th>Form of Id</th><th>Identification</th></tr><tr>'+rows.join('</tr><tr>')+'</tr></table>'

    const absPath = path.join(__dirname, 'admin-page.html')
    let content = fs.readFileSync(absPath, 'utf8')
    content = content.replaceAll('{base_url}', `${proto}://${domain}`)
    content = content.replaceAll('{table}', table)
    res.send(content)
    res.end()
  }

  // get user details
  const queryUsers = () => {
    users = []
    getResults()
//    fetch(`${opts.mattermost}/api/v4/users?inactive&in_team=${team_id}`, get_options)
//    .then(r => r.json()).then(json => {
//      users = json
//      getResults()
//    }).catch(e => {
//      console.log(`user query failed: ${e}`)
//      getResults()
//    })
  }

  // find welcome team
//  if (!team_id) {
//    fetch(`${opts.mattermost}/api/v4/teams/name/welcome`, get_options).then(r => r.json()).then(json => {
//      if (json.name == 'welcome' && json.id) {
//        team_id = json.id
//        queryUsers()
//      } else {
//        console.log(`error finding welcome team: ${JSON.stringify(json)}`)
//        getResults()
//      }
//    })
//  } else {
    queryUsers()
//  }
})


// handles ancillary files (styles, etc.) when serving for a local umbrel instance
app.get('/:path*', (req, res) => {
console.log(`a`)
  if (req.get('host').endsWith(':8767')) {
    res.redirect(`${req.protocol}://${req.hostname}:8765${req.originalUrl}`)
  } else {
    res.end();
  }
});



var http = require('http')
const port = +opts.port
http.createServer(app_options, app).listen(port)
console.log(`node ${process.version}`)
console.log(`listening on port ${port}`)
console.log(`mempool: ${MEMPOOL} / ${MEMPOOL2}`)

}) // @noble/hashes
}) // @noble/secp256k1
})
})
})
