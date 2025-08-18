import matplotlib.pyplot as pplot
from datasets import load_dataset
from transformers import ClapModel, ClapProcessor
from utils import _process_mp3, _get_chunks
from utils import ArtistData
import os
import json


model = ClapModel.from_pretrained("laion/clap-htsat-unfused")
model = model.to('cuda')
processor = ClapProcessor.from_pretrained("laion/clap-htsat-unfused")

MAX_CHUNKS = 10
MAX_TRACKS = 3
def _get_emb(audios, sampling_rate = 48000):
    inputs = processor(audios=audios,sampling_rate = sampling_rate, return_tensors="pt").to('cuda')
    audio_embed = model.get_audio_features(**inputs)
    return audio_embed.mean(0)

def _get_emb_track_path(track_path, max_chunks = MAX_CHUNKS):
    res = _process_mp3(track_path)
    res = _get_chunks(res)
    res = [r/32768.0 for r in res][:max_chunks]
    return _get_emb(res)


fpath_links = '/home/charilaos/Datasets/streetparade_25'
links_json_file = os.path.join(fpath_links, 'artist_links.json')
with open(links_json_file, 'r') as f:
    json_links = json.loads(f.read())


if __name__ == "__main__":
    root_mp3 = os.path.join(fpath_links, '.songs_cache')


    all_artists = [k for k in json_links.keys()]

    a = all_artists[0]
    ad = ArtistData(a, json_links[a], cache_folder=root_mp3)

    from tqdm import tqdm
    import numpy as np
    def get_artist_embedding(ad, max_tracks = MAX_TRACKS):
        _tracks = []
        for track_link, local_path in tqdm(ad):
            if os.path.exists(local_path):
                try:
                    _tracks.append(_get_emb_track_path(local_path).cpu().detach().numpy())
                    if len(_tracks) >= max_tracks:
                        break
                except:
                    print("error proc ", local_path)
        if len(_tracks) > 1 :
            return np.mean(_tracks, 0) 
        else:
            return _tracks

    artist_embeddings = []
    artists_avail = []
    for a in tqdm(all_artists):
        ad = ArtistData(a, json_links[a], cache_folder=root_mp3)
        artist_embeddings.append(get_artist_embedding(ad))
        artists_avail.append(a)
            

    _dat = [(n, a) for n , a in zip(artists_avail, artist_embeddings) if not isinstance(a, list)]
    _final_avail_art = [d[0] for d in _dat]
    _final_emb_dat = [d[1] for d in _dat]
    import pickle as pcl
    with open("available_art.pcl",'wb') as f:
        pcl.dump(_final_avail_art, f)
    with open("available_emb.pcl",'wb') as f:
        pcl.dump(_final_emb_dat,f)