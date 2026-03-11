class PcmProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.frameSize = 2048; // ~128ms at 16kHz
        this.floatBuffer = new Float32Array(this.frameSize);
        this.index = 0;
    }

    process(inputs) {
        const channel = inputs[0] && inputs[0][0];
        if (!channel) return true;

        for (let i = 0; i < channel.length; i++) {
            this.floatBuffer[this.index++] = channel[i];

            if (this.index === this.frameSize) {
                const pcm = new ArrayBuffer(this.frameSize * 2);
                const view = new DataView(pcm);
                let sumSq = 0;

                for (let j = 0; j < this.frameSize; j++) {
                    const s = Math.max(-1, Math.min(1, this.floatBuffer[j]));
                    const v = s < 0 ? s * 0x8000 : s * 0x7fff;
                    const sample = Math.max(-32768, Math.min(32767, Math.round(v)));
                    view.setInt16(j * 2, sample, true); // little-endian
                    sumSq += sample * sample;
                }

                const rms = Math.sqrt(sumSq / this.frameSize);
                this.port.postMessage({ pcm, rms }, [pcm]);
                this.index = 0;
            }
        }

        return true;
    }
}

registerProcessor('pcm-processor', PcmProcessor);
