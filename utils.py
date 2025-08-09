import os
import hashlib
import numpy as np
## To download tracks from sc:
try:
    from sclib import SoundcloudAPI, Track, Playlist
except:
    print("sclib not installed")
    

from pydub import AudioSegment


SAMPLING_RATE = 48_000
MAX_CHUNKS = 3
def _preproc_track(track_path, max_chunks = MAX_CHUNKS):
    if not os.path.exists(track_path):
        raise Exception(f'File {track_path} does not exist.')
    res = _process_mp3(track_path)
    
    res = _get_chunks(res)
    res = [r/32768.0 for r in res][:max_chunks]    
    return res 


def _process_mp3(input_file_path, sampling_rate = SAMPLING_RATE):
    """
    Loads an MP3 file, resamples it to 16kHz, converts it to mono,
    and saves it as a new WAV file.

    Args:
        input_file_path (str): The path to the input MP3 file.
        output_file_path (str): The path to save the processed WAV file.
    """
    try:
        # 1. Load the MP3 file
        # AudioSegment.from_mp3() will use ffmpeg to decode the mp3
        audio = AudioSegment.from_mp3(input_file_path)

        # 2. Resample to 16kHz
        # The set_frame_rate() method changes the sample rate of the audio.
        audio = audio.set_frame_rate(sampling_rate)

        # 3. Convert to mono
        # The set_channels() method changes the number of audio channels.
        # 1 for mono, 2 for stereo.
        audio = audio.set_channels(1)

        # 4. Export the processed audio
        # We export as a WAV file, which is a standard uncompressed format.
        # The format is inferred from the file extension.
        # print(f"Exporting processed audio to '{output_file_path}'...")
        return np.array(audio.get_array_of_samples())

    except FileNotFoundError:
        print(f"Error: The file '{input_file_path}' was not found.")
    except Exception as e:
        print(f"An error occurred: {e}")
        print("Please ensure ffmpeg is installed and accessible in your system's PATH.")

def _get_chunks(a, chunk_size_s = 30, chunk_skip_size_s = 60, sampling_rate = SAMPLING_RATE):
    samples_chunk = chunk_size_s * sampling_rate
    chunk_skip_samples = chunk_skip_size_s * sampling_rate
    _samples = []
    for s_start in range(0, a.shape[0], chunk_skip_samples):
        _samples.append(a[s_start:s_start + samples_chunk])
    if _samples[-1].shape != _samples[0].shape:
        _samples.pop()
    return np.vstack(_samples)

def _store_track_to_file(track_url, file_path):
    api = SoundcloudAPI()  
    track = api.resolve(track_url)
    assert type(track) is Track

    # filename = f'./{track.artist} - {track.title}'
    filename_hash = hashlib.md5(track_url.encode()).hexdigest() + '.mp3'
    fullpath = os.path.join(file_path, filename_hash)
    with open(fullpath, 'wb+') as file:
        track.write_mp3_to(file)
    print(f'written to {fullpath}')
    

class ArtistData:
    def __init__(self, artist, links, cache_folder = '.songs_cache'):
        # downloads and stores the songs of an artist to a folder.
        # uses md5 hashes for the names.
        self.artist = artist
        self.artist_hash = hashlib.md5(artist.encode()).hexdigest()
        self.artist_storage_dir = os.path.join(cache_folder, self.artist_hash)
        if not os.path.exists(self.artist_storage_dir):
            os.makedirs(self.artist_storage_dir)
        self.links = links
        
    def donwload_links(self, num_links = 2):
        for i in range(min(num_links, len(self.links))):
            track_url = self.links[i]
            filename_hash = hashlib.md5(track_url.encode()).hexdigest() + '.mp3'
            fullpath = os.path.join(self.artist_storage_dir, filename_hash)
            if os.path.exists(fullpath):
                print(f"skipping {i} - already in cache")
                continue
            _store_track_to_file(track_url, self.artist_storage_dir)
            
    def has_mp3(self):
        if len(self.links) == 0:
            return False
        return os.path.exists(self.get_track_path(0))
    
    def get_track_path(self, idx):
        track_url = self.links[idx]
        filename_hash = hashlib.md5(track_url.encode()).hexdigest() + '.mp3'
        return  os.path.join(self. artist_storage_dir, filename_hash)
    
    def __len__(self):
        return len(self.links)
    
    def __iter__(self):
        if len(self) > 0:
            for i ,flink in enumerate(self.links):
                yield flink, self.get_track_path(i)
            
    