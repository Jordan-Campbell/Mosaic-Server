var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var fs = require('fs');

const puppeteer = require('puppeteer');
const fonts = require('./fonts.json')

app.get('/', function(req, res){
   res.sendFile(__dirname + '/index.html');
});

function run() {
  for (var i = 0; i < 10; i++) {
    io.emit('message', i)
  }
}

function isGoogleFont(fontname) {
  var response = fonts[fontname]
  if (response === undefined) {
    return false
  }
  return true
}

let parse = function(snapshot) {

  const dom = snapshot['domNodes'];
  const layout = snapshot['layoutTreeNodes'];
  const styles = snapshot['computedStyles'];

  var nodeData = {};

  // generate the key
  var nonTextCounter = 1
  for(var idx = 0; idx < dom.length; idx++) {
    var key = ""
    var test = 0
    if (dom[idx]['nodeName'] != '#text') {
        key = dom[idx]['nodeName'] + "-" + generateKey(nonTextCounter)
        nonTextCounter += 1;
        test = 1
    } else {
      key = dom[idx]['nodeName'] + "-" + generateKey(0)
      test = 2
    }

    // console.log(key);
    dom[ idx ]['key'] = key;
    dom[ idx ]['parentKey'] = []
  }

  for(var idx = 0; idx < dom.length; idx++) {

    var children = dom[ idx ]["childNodeIndexes"]
    var childIndexes = []
    if (children) {
      for(var kdx = 0; kdx < children.length; kdx++) {
        childIndexes.push(dom[ children[kdx] ]["key"])
        dom[ children[kdx] ]['parentKey'].push( dom[ idx ]['key'] );
      }
    }
    dom [ idx ]['childrenKeyIndices'] = childIndexes

  }

  for (var idx = 0; idx < styles.length; idx++) {

    var font_family = styles[idx]["properties"][22]["value"]
    var font_weight = (styles[idx]["properties"][23]["value"]).toString()
    var components = font_family.split(',')
    var googleFonts = {};

    for (var i = 0; i < components.length; i++) {
      var component = components[i].trim().replace(/\"/g, '').replace(/\'/g, '');
      if(isGoogleFont(component)) {

        var weight_file = fonts[component]["files"][font_weight]
        if (weight_file === undefined) {
          googleFonts[component] = {'url':fonts[component]["files"]['regular'], 'weight': 'regular'}
        } else {
          googleFonts[component] = {'url':fonts[component]["files"][font_weight], 'weight': font_weight}
        }
      }
    }

    styles[idx]["properties"].push({"name":"googleFonts", "value":googleFonts})
  }

  var nodeKeys = [];
  for(var idx = 0; idx < layout.length; idx++) {

    var currentNode = layout[ idx ]['domNodeIndex'];

    var nodeName  = dom[ currentNode ]['nodeName'];
    var nodeValue = dom[ currentNode  ]['nodeValue'];
    var nodeLayout = layout[ idx ]['boundingBox'];
    var nodeStyle = styles[ layout[ idx ]['styleIndex'] ]

    var nodeChildren = dom[ currentNode ]['childrenKeyIndices']
    if (!nodeChildren) {
      nodeChildren = ''
    }

    var key = dom[ currentNode ]['key'];
    var pkey = dom[ currentNode ]['parentKey'];

    var attr = dom[ currentNode ]['attributes']

    if (!attr) {
	attr = [{
		'name':'atlas',
		'value':'reality'
	        }
	       ]
    }

    if (!pkey) {
      pkey = ''
    }

    if (nodeStyle) {
      nodeStyle = nodeStyle['properties']
    } else {
	//nodeStyle = [{'atlas':'reality'}]
	nodeStyle = [{
		      'name':'atlas',
		      'value':'reality'
	             }
	            ]
    }

    var node = {
        'nodeName' : nodeName,
        'nodeValue' : nodeValue,
        'nodeLayout' : nodeLayout,
        'nodeChildren' : nodeChildren,
        'nodeStyle' : nodeStyle,
        'key' : key,
        'pkey' : pkey,
        'attr': attr
    };
    nodeData[key] = node;
    nodeKeys.push(key);

  }

  return [nodeData, nodeKeys]
}

function sendData(snapshot, socket) {
  io.emit('renderTreeStart')

  console.time("parse");
  var parsed = parse(snapshot)
  var data = parsed[0]
  var keys = parsed[1]
  console.timeEnd("parse");

  console.time("renderTree");
  var renderTree = [];
  var ptr = 0;
  data[keys[ptr]]['depth'] = 0
  socket.emit('node', data[ keys[ptr] ]  )
  renderTree.push( keys[ptr] )

  while(ptr < renderTree.length) {
      // get the next key
      var next = renderTree[ ptr ]

      // get the list of child keys for this node
      var children = data[ next ]['nodeChildren']
      if (children) {

          // for each of the child keys
          for (var i = 0; i < children.length; i++) {

              if ( data[children[i]] ) {
                  renderTree.push(children[i]);
                  data[children[i]]['depth'] = data[ next ]['depth'] + 1
                  socket.emit('node', data[children[i]]  )
              }
          }
      }
      ptr += 1
  }

  socket.emit('renderTreeComplete')

  // console.log(renderTree);
  console.log("Processing complete.");
}

io.on('connection', function(socket) {

   console.log('connection on server established ...');

   io.emit('response', "Connection successful")

   socket.on('msg', function(msg) {
      console.log(`msg recvd: ${msg}`);
   });

   socket.on('url', function(url) {
      console.log(`url recvd: ${url}`);

      getData(url).then( function(snapshot) {

        if (snapshot["atlas"]["filename"] != "") {
          var configFileName = snapshot["atlas"]["filename"] + ".json"
          console.log(`Reading from config file: ${configFileName}`);
          fs.readFile(configFileName, function(err, data){
            data = JSON.parse(data);
            socket.emit('config', data, function(response) {
              // should execute this code when the client receives this data
              console.log("config emit ack received");

              sendData(snapshot, socket)

            });
          });
        } else {
          sendData(snapshot, socket)
        }

      });
   });
});

function generateKey() {
  var text = "";
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()";
  var keyLength = 8;

  for (var i = 0; i < keyLength; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return text;
}

function getAtlas(snapshot) {
  atlas = {}
  for (var i = 0; i < snapshot["domNodes"].length; i++) {
    if (snapshot["domNodes"][i]["nodeName"] == "ATLAS") {
      atlas['data'] = snapshot["domNodes"][i]
      console.log(atlas['data']);
      var attr = atlas["data"]["attributes"]
      if (attr) {
        for (var i = 0; i < attr.length; i++) {
          if(attr[i]["name"] == 'id') {
            console.log(attr[i]);
            atlas["filename"] = attr[i]["value"]
            return atlas
          }
        }
      }
    }
  }
  return atlas
}
async function getData(url) {

  console.time("headlessChrome-total");
  console.time("browserOpen");
  const browser = await puppeteer.launch()
  const page = await browser.newPage()

  console.timeEnd("browserOpen");
  console.time("gotoPage");
  await page.goto(url)
  console.timeEnd("gotoPage");
  // await page.setViewport({
  // 	width: 1920,
  // 	height: 1080
  // });

  await page.setViewport({
  	width: 1400,
  	height: 1080
  });

  console.time("getDOM");
  await page._client.send('DOM.enable')
  await page._client.send('CSS.enable')
  await page._client.send('Animation.setPlaybackRate', { playbackRate: 12 });

  const computedStyles = ['color', 'background-color', 'border-color', 'border-width', 'font-size',
                        'border-left-color', 'border-left-style', 'border-left-width',
                        'border-right-color', 'border-right-style', 'border-right-width',
                        'border-top-color', 'border-top-style', 'border-top-width',
                        'border-bottom-color', 'border-bottom-style', 'border-bottom-width',
                        'padding-left', 'padding-right', 'padding-top', 'padding-bottom',
                        'background-image',
                        'font-family', 'font-weight',
                        'display'
                      ];

  const snapshot = await page._client.send('DOMSnapshot.getSnapshot', {computedStyleWhitelist:computedStyles});
  // const doc = await page._client.send('DOM.getDocument')
  // const atlasNode = await page._client.send('DOM.querySelector', {nodeId: doc.root.nodeId, selector: 'atlas'})
  // s
  snapshot["atlas"] = getAtlas(snapshot)
  console.log(  `atlas-file: ${snapshot["atlas"]["filename"]}` );
  console.log(  `atlas: ${snapshot["atlas"]}` );

  console.timeEnd("getDOM");
  await browser.close()
  console.timeEnd("headlessChrome-total");
  return snapshot
}

http.listen(3000, function(){
   console.log('listening on *:3000');
});
