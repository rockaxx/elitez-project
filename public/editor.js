import Rete from 'rete';

class MalwareComponent extends Rete.Component {
  constructor() {
    super("MalwareComponent");
  }

  async builder(node) {
    node.addInput(new Rete.Input('inp', "Input", this.editor.sockets.any));
    node.addOutput(new Rete.Output('out', "Output", this.editor.sockets.any));
    node.addControl(new Rete.Control(this.editor, 'name', node));
  }

  worker(node, inputs, outputs) {
    console.log("Node executed", node);
  }
}

async function createEditor() {
  const container = document.querySelector('#editor');
  const editor = new Rete.NodeEditor('malware@0.1.0', container);

  editor.use(ConnectionPlugin);
  editor.use(VueRenderPlugin); // optional

  const engine = new Rete.Engine('malware@0.1.0');
  const component = new MalwareComponent();

  editor.register(component);
  engine.register(component);

  const node = await component.createNode();
  node.position = [80, 200];
  editor.addNode(node);

  editor.view.resize();
  editor.trigger('process');
}

createEditor();
