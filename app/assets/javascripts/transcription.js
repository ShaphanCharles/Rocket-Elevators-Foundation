console.log("transcription")

// On document load resolve the Speech SDK dependency
function Initialize(onComplete) {
    if (!!window.SpeechSDK) {
        document.getElementById('content').style.display = 'block';
        document.getElementById('warning').style.display = 'none';
        onComplete(window.SpeechSDK);
    }
}

var SpeechSDK;
var phraseDiv, statusDiv;
var key, authorizationToken, appId, phrases;
var regionOptions;
var languageOptions, formatOption, filePicker, microphoneSources;
var useDetailedResults;
var recognizer;
var inputSourceMicrophoneRadio, inputSourceFileRadio;
var scenarioSelection, scenarioStartButton, scenarioStopButton;
var formatSimpleRadio, formatDetailedRadio;
var reco;
var languageTargetOptions, voiceOutput;
var audioFile;
var microphoneId;
var referenceText;
var pronunciationAssessmentResults;

var thingsToDisableDuringSession;

var soundContext = undefined;
try {
    var AudioContext = window.AudioContext // our preferred impl
        || window.webkitAudioContext       // fallback, mostly when on Safari
        || false;                          // could not find.

    if (AudioContext) {
        soundContext = new AudioContext();
    } else {
        alert("Audio context not supported");
    }
} catch (e) {
    window.console.log("no sound context found, no audio output. " + e);
}

function resetUiForScenarioStart() {
    phraseDiv.innerHTML = "";
    statusDiv.innerHTML = "";
    useDetailedResults = document.querySelector('input[name="formatOption"]:checked').value === "Detailed";
    pronunciationAssessmentResults = [];
}

document.addEventListener("DOMContentLoaded", function () {
    scenarioStartButton = document.getElementById('scenarioStartButton');
    scenarioStopButton = document.getElementById('scenarioStopButton');
    scenarioSelection = document.getElementById('scenarioSelection');

    phraseDiv = document.getElementById("phraseDiv");
    statusDiv = document.getElementById("statusDiv");
    key = document.getElementById("key");
    appId = document.getElementById("appId");
    phrases = document.getElementById("phrases");
    languageOptions = document.getElementById("languageOptions");
    languageTargetOptions = document.getElementById("languageTargetOptions");
    voiceOutput = document.getElementById("voiceOutput");
    regionOptions = document.getElementById("regionOptions");
    filePicker = document.getElementById('filePicker');
    microphoneSources = document.getElementById("microphoneSources");
    inputSourceFileRadio = document.getElementById('inputSourceFileRadio');
    inputSourceMicrophoneRadio = document.getElementById('inputSourceMicrophoneRadio');
    formatSimpleRadio = document.getElementById('formatSimpleRadio');
    formatDetailedRadio = document.getElementById('formatDetailedRadio');
    referenceText = document.getElementById('referenceText');

    thingsToDisableDuringSession = [
        key,
        regionOptions,
        languageOptions,
        inputSourceMicrophoneRadio,
        inputSourceFileRadio,
        scenarioSelection,
        formatSimpleRadio,
        formatDetailedRadio,
        appId,
        phrases,
        languageTargetOptions
    ];

    function setScenario() {
        var startButtonText = (function() {
            switch (scenarioSelection.value) {
                case 'speechRecognizerRecognizeOnce':
                case 'intentRecognizerRecognizeOnce':
                // case 'pronunciationAssessmentOnce': return 'recognizeOnceAsync()';
                case 'pronunciationAssessmentOnce': return 'START';
                case 'speechRecognizerContinuous': 
                // case 'pronunciationAssessmentContinuous': return 'startContinuousRecognitionAsync()';
                case 'pronunciationAssessmentContinuous': return 'Start Continuous Assessment';
                // case 'translationRecognizerContinuous': return 'startContinuousTranslation()';
                case 'translationRecognizerContinuous': return 'Start Continuous Translation';
            }
        })();

        scenarioStartButton.innerHTML = startButtonText;
        // scenarioStopButton.innerHTML = `STOP ${startButtonText}`;
        scenarioStopButton.innerHTML = `STOP`;

        document.getElementById('languageUnderstandingAppIdRow').style.display =
            scenarioSelection.value === 'intentRecognizerRecognizeOnce' ? '' : 'none';

        var detailedResultsSupported = 
            (scenarioSelection.value === "speechRecognizerRecognizeOnce"
            || scenarioSelection.value === "speechRecognizerContinuous");
        document.getElementById('formatOptionRow').style.display = detailedResultsSupported ? '' : 'none';

        document.getElementById('translationOptionsRow').style.display =
            scenarioSelection.value == 'translationRecognizerContinuous' ? '' : 'none';
        
        document.getElementById('pronunciationAssessmentReferenceTextRow').style.display =
            scenarioSelection.value.includes('pronunciation') ? '' : 'none';
    }

    scenarioSelection.addEventListener("change", function () {
        setScenario();
    });
    setScenario();

    scenarioStartButton.addEventListener("click", function () {
        switch (scenarioSelection.value) {
            case 'speechRecognizerRecognizeOnce':
                doRecognizeOnceAsync();
                break;
            case 'speechRecognizerContinuous':
                doContinuousRecognition();
                break;
            case 'intentRecognizerRecognizeOnce':
                doRecognizeIntentOnceAsync();
                break;
            case 'translationRecognizerContinuous':
                doContinuousTranslation();
                break;
            case 'pronunciationAssessmentOnce':
                doPronunciationAssessmentOnceAsync();
                break;
            case 'pronunciationAssessmentContinuous':
                doContinuousPronunciationAssessment();
                break;
        }
    });

    scenarioStopButton.addEventListener("click", function() {
        switch (scenarioSelection.value) {
            case 'speechRecognizerRecognizeOnce':
            case 'intentRecognizerRecognizeOnce':
            case 'pronunciationAssessmentOnce':
                reco.close();
                reco = undefined;
                break;
            case 'speechRecognizerContinuous':
            case 'translationRecognizerContinuous':
            case 'pronunciationAssessmentContinuous':
                reco.stopContinuousRecognitionAsync(
                    function () {
                        reco.close();
                        reco = undefined;
                    },
                    function (err) {
                        reco.close();
                        reco = undefined;
                    }
                );
                break;
        }
    });

    function enumerateMicrophones() {
        if (!navigator || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
            console.log(`Unable to query for audio input devices. Default will be used.\r\n`);
            return;
        }

        navigator.mediaDevices.enumerateDevices().then((devices) => {
            microphoneSources.innerHTML = '';

            // Not all environments will be able to enumerate mic labels and ids. All environments will be able
            // to select a default input, assuming appropriate permissions.
            var defaultOption = document.createElement('option');
            defaultOption.appendChild(document.createTextNode('Default Microphone'));
            microphoneSources.appendChild(defaultOption);

            for (const device of devices) {
                if (device.kind === "audioinput") {
                    if (!device.deviceId) {
                        window.console.log(
                            `Warning: unable to enumerate a microphone deviceId. This may be due to limitations`
                            + ` with availability in a non-HTTPS context per mediaDevices constraints.`); 
                    }
                    else {
                        var opt = document.createElement('option');
                        opt.value = device.deviceId;
                        opt.appendChild(document.createTextNode(device.label));

                        microphoneSources.appendChild(opt);
                    }
                }
            }

            microphoneSources.disabled = (microphoneSources.options.length == 1);
        });
    }

    inputSourceMicrophoneRadio.addEventListener("click", function () {
        enumerateMicrophones();
        document.getElementById('inputSourceChooseFileButton').disabled = true;
    });

    inputSourceFileRadio.addEventListener("click", function() {
        document.getElementById('inputSourceChooseFileButton').disabled = false;
    });

    document.getElementById('inputSourceChooseFileButton').addEventListener("click", function() {
        document.getElementById('inputSourceFileLabel').innerHTML = 'Select audio file';
        audioFile = undefined;
        filePicker.click();
    });

    filePicker.addEventListener("change", function () {
        audioFile = filePicker.files[0];
        document.getElementById('inputSourceFileLabel').innerHTML = audioFile.name;
    });

    enumerateMicrophones();

    Initialize(function (speechSdk) {
        SpeechSDK = speechSdk;

        // in case we have a function for getting an authorization token, call it.
        if (typeof RequestAuthorizationToken === "function") {
            RequestAuthorizationToken();
        }
    });
});

function getAudioConfig() {
    // If an audio file was specified, use it. Otherwise, use the microphone.
    // Depending on browser security settings, the user may be prompted to allow microphone use. Using
    // continuous recognition allows multiple phrases to be recognized from a single use authorization.
    if (audioFile) {
        return SpeechSDK.AudioConfig.fromWavFileInput(audioFile);
    } else if (inputSourceFileRadio.checked) {
        alert('Please choose a file when selecting file input as your audio source.');
        return;
    } else if (microphoneSources.value) {
        return SpeechSDK.AudioConfig.fromMicrophoneInput(microphoneSources.value);
    } else {
        return SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
    }
}

function getSpeechConfig(sdkConfigType) {
    var speechConfig;
    if (authorizationToken) {
        speechConfig = sdkConfigType.fromAuthorizationToken(authorizationToken, regionOptions.value);
    } else if (!key.value) {
        alert("Please enter your Cognitive Services Speech subscription key!");
        return undefined;
    } else {
        speechConfig = sdkConfigType.fromSubscription(key.value, regionOptions.value);
    }

    // Setting the result output format to Detailed will request that the underlying
    // result JSON include alternates, confidence scores, lexical forms, and other
    // advanced information.
    if (useDetailedResults && sdkConfigType != SpeechSDK.SpeechConfig) {
        window.console.log('Detailed results are not supported for this scenario.\r\n');
        document.getElementById('formatSimpleRadio').click();
    } else if (useDetailedResults) {
        speechConfig.outputFormat = SpeechSDK.OutputFormat.Detailed;
    }

    // Defines the language(s) that speech should be translated to.
    // Multiple languages can be specified for text translation and will be returned in a map.
    if (sdkConfigType == SpeechSDK.SpeechTranslationConfig) {
        speechConfig.addTargetLanguage(languageTargetOptions.value.split("(")[1].substring(0, 5));
    }

    speechConfig.speechRecognitionLanguage = languageOptions.value;
    return speechConfig;
}

function getPronunciationAssessmentConfig() {
    var pronunciationAssessmentConfig = new SpeechSDK.PronunciationAssessmentConfig(referenceText.value,
        SpeechSDK.PronunciationAssessmentGradingSystem.HundredMark,
        SpeechSDK.PronunciationAssessmentGranularity.Word, true);
    return pronunciationAssessmentConfig;
}

function onRecognizing(sender, recognitionEventArgs) {
    var result = recognitionEventArgs.result;
    statusDiv.innerHTML += `(recognizing) Reason: ${SpeechSDK.ResultReason[result.reason]}`
        + ` Text: ${result.text}\r\n`;
    // Update the hypothesis line in the phrase/result view (only have one)
    phraseDiv.innerHTML = phraseDiv.innerHTML.replace(/(.*)(^|[\r\n]+).*\[\.\.\.\][\r\n]+/, '$1$2')
        + `${result.text} [...]\r\n`;
    phraseDiv.scrollTop = phraseDiv.scrollHeight;
}

function onRecognized(sender, recognitionEventArgs) {
    var result = recognitionEventArgs.result;
    onRecognizedResult(recognitionEventArgs.result);
}

function onRecognizedResult(result) {
    phraseDiv.scrollTop = phraseDiv.scrollHeight;

    statusDiv.innerHTML += `(recognized)  Reason: ${SpeechSDK.ResultReason[result.reason]}`;
    if (scenarioSelection.value === 'speechRecognizerRecognizeOnce'
        || scenarioSelection.value === 'intentRecognizerRecognizeOnce') {
        // Clear the final results view for single-shot scenarios
        phraseDiv.innerHTML = '';
    } else {
        // Otherwise, just remove the ongoing hypothesis line
        phraseDiv.innerHTML = phraseDiv.innerHTML.replace(/(.*)(^|[\r\n]+).*\[\.\.\.\][\r\n]+/, '$1$2');
    }

    switch (result.reason) {
        case SpeechSDK.ResultReason.NoMatch:
            var noMatchDetail = SpeechSDK.NoMatchDetails.fromResult(result);
            statusDiv.innerHTML += ` NoMatchReason: ${SpeechSDK.NoMatchReason[noMatchDetail.reason]}\r\n`;
            break;
        case SpeechSDK.ResultReason.Canceled:
            var cancelDetails = SpeechSDK.CancellationDetails.fromResult(result);
            statusDiv.innerHTML += ` CancellationReason: ${SpeechSDK.CancellationReason[cancelDetails.reason]}`;
                + (cancelDetails.reason === SpeechSDK.CancellationReason.Error 
                    ? `: ${cancelDetails.errorDetails}` : ``)
                + `\r\n`;
            break;
        case SpeechSDK.ResultReason.RecognizedSpeech:
        case SpeechSDK.ResultReason.TranslatedSpeech:
        case SpeechSDK.ResultReason.RecognizedIntent:
            statusDiv.innerHTML += `\r\n`;

            if (useDetailedResults) {
                var detailedResultJson = JSON.parse(result.json);

                // Detailed result JSON includes substantial extra information:
                //  detailedResultJson['NBest'] is an array of recognition alternates
                //  detailedResultJson['NBest'][0] is the highest-confidence alternate
                //  ...['Confidence'] is the raw confidence score of an alternate
                //  ...['Lexical'] and others provide different result forms
                var displayText = detailedResultJson['DisplayText'];
                phraseDiv.innerHTML += `Detailed result for "${displayText}":\r\n`
                + `${JSON.stringify(detailedResultJson, null, 2)}\r\n`;
            } else if (result.text) {
                phraseDiv.innerHTML += `${result.text}\r\n`;
            }

            var intentJson = result.properties
                .getProperty(SpeechSDK.PropertyId.LanguageUnderstandingServiceResponse_JsonResult);
            if (intentJson) {
                phraseDiv.innerHTML += `${intentJson}\r\n`;
            }

            if (result.translations) {
                var resultJson = JSON.parse(result.json);
                resultJson['privTranslationPhrase']['Translation']['Translations'].forEach(
                    function (translation) {
                    phraseDiv.innerHTML += ` [${translation.Language}] ${translation.Text}\r\n`;
                });
            }

            if (scenarioSelection.value.includes('pronunciation')) {
                var pronunciationAssessmentResult = SpeechSDK.PronunciationAssessmentResult.fromResult(result);
                phraseDiv.innerHTML += 
                `[Pronunciation result] Accuracy: ${pronunciationAssessmentResult.accuracyScore}; 
               Fluency: ${pronunciationAssessmentResult.fluencyScore};
               Completeness: ${pronunciationAssessmentResult.completenessScore}.\n`;
                pronunciationAssessmentResults.push(pronunciationAssessmentResult);
            }
            break;
    }
}

function onSessionStarted(sender, sessionEventArgs) {
    statusDiv.innerHTML += `(sessionStarted) SessionId: ${sessionEventArgs.sessionId}\r\n`;

    for (const thingToDisableDuringSession of thingsToDisableDuringSession) {
        thingToDisableDuringSession.disabled = true;
    }

    scenarioStartButton.disabled = true;
    scenarioStopButton.disabled = false;
}

function onSessionStopped(sender, sessionEventArgs) {
    statusDiv.innerHTML += `(sessionStopped) SessionId: ${sessionEventArgs.sessionId}\r\n`;

    if (scenarioSelection.value == 'pronunciationAssessmentContinuous') {       
        for (const thingToDisableDuringSession of thingsToDisableDuringSession) {
            thingToDisableDuringSession.disabled = false;
        }

        scenarioStartButton.disabled = false;
        scenarioStopButton.disabled = true;
    
        calculateOverallPronunciationScore();
    }

    for (const thingToDisableDuringSession of thingsToDisableDuringSession) {
        thingToDisableDuringSession.disabled = false;
    }
    
    scenarioStartButton.disabled = false;
    scenarioStopButton.disabled = true;
}

function onCanceled (sender, cancellationEventArgs) {
    window.console.log(e);

    statusDiv.innerHTML += "(cancel) Reason: " + SpeechSDK.CancellationReason[e.reason];
    if (e.reason === SpeechSDK.CancellationReason.Error) {
        statusDiv.innerHTML += ": " + e.errorDetails;
    }
    statusDiv.innerHTML += "\r\n";
}

function applyCommonConfigurationTo(recognizer) {
    // The 'recognizing' event signals that an intermediate recognition result is received.
    // Intermediate results arrive while audio is being processed and represent the current "best guess" about
    // what's been spoken so far.
    recognizer.recognizing = onRecognizing;

    // The 'recognized' event signals that a finalized recognition result has been received. These results are
    // formed across complete utterance audio (with either silence or eof at the end) and will include
    // punctuation, capitalization, and potentially other extra details.
    // 
    // * In the case of continuous scenarios, these final results will be generated after each segment of audio
    //   with sufficient silence at the end.
    // * In the case of intent scenarios, only these final results will contain intent JSON data.
    // * Single-shot scenarios can also use a continuation on recognizeOnceAsync calls to handle this without
    //   event registration.
    recognizer.recognized = onRecognized;

    // The 'canceled' event signals that the service has stopped processing speech.
    // https://docs.microsoft.com/javascript/api/microsoft-cognitiveservices-speech-sdk/speechrecognitioncanceledeventargs?view=azure-node-latest
    // This can happen for two broad classes of reasons:
    // 1. An error was encountered.
    //    In this case, the .errorDetails property will contain a textual representation of the error.
    // 2. No additional audio is available.
    //    This is caused by the input stream being closed or reaching the end of an audio file.
    recognizer.canceled = onCanceled;

    // The 'sessionStarted' event signals that audio has begun flowing and an interaction with the service has
    // started.
    reco.sessionStarted = onSessionStarted;

    // The 'sessionStopped' event signals that the current interaction with the speech service has ended and
    // audio has stopped flowing.
    reco.sessionStopped = onSessionStopped;

    // PhraseListGrammar allows for the customization of recognizer vocabulary.
    // The semicolon-delimited list of words or phrases will be treated as additional, more likely components
    // of recognition results when applied to the recognizer.
    //
    // See https://docs.microsoft.com/azure/cognitive-services/speech-service/get-started-speech-to-text#improve-recognition-accuracy
    if (phrases.value) {
        var phraseListGrammar = SpeechSDK.PhraseListGrammar.fromRecognizer(reco);
        phraseListGrammar.addPhrase(phrases.value.split(";"));
    }
}

function calculateOverallPronunciationScore() {
    if (difflib === undefined) {
        phraseDiv.innerHTML += `ERROR: difflib-browser.js is needed for pronunciation assessment calculation; see https://github.com/qiao/difflib.js`;
    }
    // strip punctuation
    var referenceWords = referenceText.value.toLowerCase().replace(/[.,\/#!?$%\^&\*;:{}=\-_`~()]/g,"");
    referenceWords = referenceWords.split(' ');
    
    var recognizedWords = [];
    var sumDuration = 0;
    var sumAccuracy = 0;
    var sumFluency = 0;
    for (const result of pronunciationAssessmentResults) {
        var duration = 0;
        for (const word of result.detailResult.Words) {
            recognizedWords.push(word.Word);
            duration += word.Duration;
        }
        sumDuration += duration;
        sumAccuracy += duration * result.accuracyScore;
        sumFluency += duration * result.fluencyScore;
    }
    
    // weighted accuracy and fluency scores
    var accuracy = sumAccuracy / sumDuration;
    var fluency = sumFluency / sumDuration;

    var diff = new difflib.SequenceMatcher(null, referenceWords, recognizedWords);
    diffWordsNum = 0;
    for (const d of diff.getOpcodes()) {
        if (d[0] == 'delete' || d[0] == 'replace') {
            diffWordsNum += (d[2] - d[1]);
        }
    }

    var completeness = (1 - diffWordsNum / referenceWords.length) * 100;
    
    phraseDiv.innerHTML +=
        `[Overall Pronunciation result] Accuracy: ${accuracy}; 
               Fluency: ${fluency};
               Completeness: ${completeness}.\n`;
}
function doRecognizeOnceAsync() {
    resetUiForScenarioStart();

    var audioConfig = getAudioConfig();
    var speechConfig = getSpeechConfig(SpeechSDK.SpeechConfig);
    if (!audioConfig || !speechConfig) return;

    // Create the SpeechRecognizer and set up common event handlers and PhraseList data
    reco = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);
    applyCommonConfigurationTo(reco);

    // Note: in this scenario sample, the 'recognized' event is not being set to instead demonstrate
    // continuation on the 'recognizeOnceAsync' call. 'recognized' can be set in much the same way as
    // 'recognizing' if an event-driven approach is preferable.
    reco.recognized = undefined;

    // Note: this scenario sample demonstrates result handling via continuation on the recognizeOnceAsync call.
    // The 'recognized' event handler can be used in a similar fashion.
    reco.recognizeOnceAsync(
        function (successfulResult) {
            onRecognizedResult(successfulResult);
        },
        function (err) {
            window.console.log(err);
            phraseDiv.innerHTML += "ERROR: " + err;
        });
}

function doContinuousRecognition() {
    resetUiForScenarioStart();

    var audioConfig = getAudioConfig();
    var speechConfig = getSpeechConfig(SpeechSDK.SpeechConfig);
    if (!speechConfig) return;

    // Create the SpeechRecognizer and set up common event handlers and PhraseList data
    reco = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);
    applyCommonConfigurationTo(reco);

    // Start the continuous recognition. Note that, in this continuous scenario, activity is purely event-
    // driven, as use of continuation (as is in the single-shot sample) isn't applicable when there's not a
    // single result.
    reco.startContinuousRecognitionAsync();
}

function doRecognizeIntentOnceAsync() {
    resetUiForScenarioStart();
    var audioConfig = getAudioConfig();
    var speechConfig = getSpeechConfig(SpeechSDK.SpeechConfig);
    if (!audioConfig || !speechConfig) return;

    if (!appId.value) {
        alert('A language understanding appId is required for intent recognition.');
        return;
    }

    // Intent recognizers should be configured with a LanguageUnderstandingModel derived from a known appId.
    // Set up a Language Understanding Model from Language Understanding Intelligent Service (LUIS).
    // See https://www.luis.ai/home for more information on LUIS.
    reco = new SpeechSDK.IntentRecognizer(speechConfig, audioConfig);
    var intentModel = SpeechSDK.LanguageUnderstandingModel.fromAppId(appId.value);
    reco.addAllIntents(intentModel);

    // Apply standard event handlers and PhraseListGrammar data
    applyCommonConfigurationTo(reco);

    // Start the intent recognition. Results will arrive on the appropriate event handlers.
    reco.recognizeOnceAsync();
}

function doContinuousTranslation() {
    resetUiForScenarioStart();

    var audioConfig = getAudioConfig();
    var speechConfig = getSpeechConfig(SpeechSDK.SpeechTranslationConfig);
    if (!audioConfig || !speechConfig) return;

    // Create the TranslationRecognizer and set up common event handlers and PhraseListGrammar data.
    reco = new SpeechSDK.TranslationRecognizer(speechConfig, audioConfig);
    applyCommonConfigurationTo(reco);

    // Additive in TranslationRecognizer, the 'synthesizing' event signals that a payload chunk of synthesized
    // text-to-speech data is available for playback.
    // If the event result contains valid audio, it's reason will be ResultReason.SynthesizingAudio
    // Once a complete phrase has been synthesized, the event will be called with
    // ResultReason.SynthesizingAudioComplete and a 0-byte audio payload.
    reco.synthesizing = function (s, e) {
        var audioSize = e.result.audio === undefined ? 0 : e.result.audio.byteLength;

        statusDiv.innerHTML += `(synthesizing) Reason: ${SpeechSDK.ResultReason[e.result.reason]}`
            + ` ${audioSize} bytes\r\n`;

        if (e.result.audio && soundContext) {
            var source = soundContext.createBufferSource();
            soundContext.decodeAudioData(e.result.audio, function (newBuffer) {
                source.buffer = newBuffer;
                source.connect(soundContext.destination);
                source.start(0);
            });
        }
    };

    // Start the continuous recognition/translation operation.
    reco.startContinuousRecognitionAsync();
}

function doPronunciationAssessmentOnceAsync() {
    resetUiForScenarioStart();

    var audioConfig = getAudioConfig();
    var speechConfig = getSpeechConfig(SpeechSDK.SpeechConfig);
    var pronunciationAssessmentConfig = getPronunciationAssessmentConfig();
    if (!audioConfig || !speechConfig || !pronunciationAssessmentConfig) return;

    // Create the SpeechRecognizer and set up common event handlers and PhraseList data
    reco = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);
    applyCommonConfigurationTo(reco);

    // Apply pronunciation assessment config to recognizer.
    pronunciationAssessmentConfig.applyTo(reco);

    // Note: in this scenario sample, the 'recognized' event is not being set to instead demonstrate
    // continuation on the 'recognizeOnceAsync' call. 'recognized' can be set in much the same way as
    // 'recognizing' if an event-driven approach is preferable.
    reco.recognized = undefined;

    // Note: this scenario sample demonstrates result handling via continuation on the recognizeOnceAsync call.
    // The 'recognized' event handler can be used in a similar fashion.
    reco.recognizeOnceAsync(
        function (successfulResult) {
            onRecognizedResult(successfulResult);
        },
        function (err) {
            window.console.log(err);
            phraseDiv.innerHTML += "ERROR: " + err;
        });
}

function doContinuousPronunciationAssessment() {
    resetUiForScenarioStart();

    var audioConfig = getAudioConfig();
    var speechConfig = getSpeechConfig(SpeechSDK.SpeechConfig);
    var pronunciationAssessmentConfig = getPronunciationAssessmentConfig();
    if (!speechConfig) return;

    // Create the SpeechRecognizer and set up common event handlers and PhraseList data
    reco = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);
    applyCommonConfigurationTo(reco);

    // Apply pronunciation assessment config to recognizer.
    pronunciationAssessmentConfig.applyTo(reco);

    // Start the continuous recognition. Note that, in this continuous scenario, activity is purely event-
    // driven, as use of continuation (as is in the single-shot sample) isn't applicable when there's not a
    // single result.
    reco.startContinuousRecognitionAsync();
}