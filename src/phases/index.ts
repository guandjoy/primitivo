import { pipe } from "fp-ts/lib/pipeable";
import pathLayer from "../path/index";
import morphingLayer from "../morphing/index";
var log = require("loglevel").getLogger("phases-log");

// Path interfaces
import {
  PathData,
  InputParameters as PathInputParameters,
  GroupParameters,
  Vertex
} from "../path/interfaces";

// Interfaces
import {
  InputParameters,
  Data,
  Phase,
  BaseParameters,
  PhaseGroupParameters,
  GroupParameterMethod,
  ProgressionsPhaseScopeMethod,
  ProgressionsGeneralScopeMethod
} from "./interfaces";

// Defaults
import defaultParameters from "./defaultParameters";
// Methods
import generateOuterPaths from "./lib/generateOuterPaths";

const setParameters = (parameters: InputParameters): Data => ({ parameters });

const calcProgressions = (data: Data): Data => {
  const { parameters, startPath, endPath } = data;
  const numOfPhases = parameters.phases.length;

  var progressionsPhaseScope: number[][] = Array(numOfPhases);
  var progressionsGeneralScope: any = Array(numOfPhases);
  var progressions: number[] = [];
  var durations: number[] = [];

  for (let i = 0; i < numOfPhases; i++) {
    const duration = parameters.phases[i].duration({
      startPath,
      endPath,
      prevDurations: durations
    });
    durations.push(duration);
    // Calc progressionsPhaseScope
    progressionsPhaseScope[i] = parameters.phases[i].progressionsPhaseScope({
      startPath,
      endPath,
      duration
    });
    // Calc progressionsGeneralScope
    const prevPhaseProgressions = i && progressionsGeneralScope[i - 1];
    progressionsGeneralScope[i] = parameters.phases[i].progressionsGeneralScope(
      {
        startPath,
        endPath,
        duration,
        prevPhaseProgressions
      }
    );

    // Form progressions objects
    for (
      let keyVertexIndex = 0;
      keyVertexIndex < progressionsGeneralScope[i].length;
      keyVertexIndex++
    )
      progressions.push(progressionsGeneralScope[i][keyVertexIndex]);
  }

  log.debug("progressions phase scope", progressionsPhaseScope);
  log.debug("progressions general scope", progressionsGeneralScope);

  // Sort progressions objects
  progressions = progressions.sort((a: number, b: number) => a - b);

  // Remove dublicates
  let i = 1;
  while (i < progressions.length) {
    if (progressions[i - 1] === progressions[i]) progressions.splice(i, 1);
    else i += 1;
  }
  log.debug("progressions", progressions);
  return {
    ...data,
    progressions,
    progressionsGeneralScope,
    progressionsPhaseScope
  };
};

const generateGroupsParameters = (data: Data): Data => {
  // Set groups parameters for each progression and each vertex
  const {
    endPath,
    startPath,
    progressions,
    progressionsGeneralScope,
    progressionsPhaseScope
  } = data;
  const { phases } = data.parameters;
  const numOfPhases = phases.length;

  var pathsGroupsParameters: GroupParameters[][] = Array(progressions.length);

  for (let prIndex = 0; prIndex < progressions.length; prIndex++) {
    pathsGroupsParameters[prIndex] = [];
    endPath.vertexes.forEach((vertex, vIndex) => {
      const gIndex = vertex.group;
      const { indexWithingGroup } = vertex;

      // loop vertexes
      var activePhaseIndex;
      var keyVertexIndex;
      for (let phIndex = 0; phIndex < numOfPhases; phIndex++) {
        // loop phases and pick first incomplete phase to take values from
        // Check if current phase is incomplete
        let phaseIsIncomplete =
          progressions[prIndex] <= progressionsGeneralScope[phIndex][vIndex];

        if (phaseIsIncomplete) {
          // Current phase is the one we need. Break phases loop.
          const { groupsParameters } = phases[phIndex];
          activePhaseIndex = phIndex;
          break;
        }
      }

      if (pathsGroupsParameters[prIndex][gIndex] === undefined)
        pathsGroupsParameters[prIndex][gIndex] = {};

      var parametersSource =
        // If activePhaseIndex is undefined set previous progression values as a source
        activePhaseIndex === undefined
          ? pathsGroupsParameters[prIndex - 1][gIndex]
          : phases[activePhaseIndex].groupsParameters[gIndex];

      for (let [key, source] of Object.entries(parametersSource)) {
        // loop group param methods and take values

        let value =
          // If activePhaseIndex is undefined take value from previus progression
          activePhaseIndex === undefined
            ? source[indexWithingGroup]
            : source({
                startPath,
                endPath,
                vertex,
                progression: progressions[prIndex],
                activePhaseIndex,
                progressionsGeneralScope,
                progressionsPhaseScope
              });

        if (pathsGroupsParameters[prIndex][gIndex][key] === undefined)
          pathsGroupsParameters[prIndex][gIndex][key] = [];

        pathsGroupsParameters[prIndex][gIndex][key][indexWithingGroup] = value;
      }
    });
  }
  log.debug("paths groups parameters", pathsGroupsParameters);
  return { ...data, pathsGroupsParameters };
};

const generateDValues = (data: Data): Data => {
  log.info("start generate d values");
  const {
    loop,
    baseParameters,
    startGroupsParameters,
    endGroupsParameters
  } = data.parameters;
  const { pathsGroupsParameters } = data;
  const morphingParams = {
    numOfKeyPaths: pathsGroupsParameters.length + 1,
    loop
  };
  log.debug("morphing params", morphingParams);
  // data.progressions.push(1);
  data.progressions.unshift(0);
  const pathsParams = {
    ...baseParameters,
    groups: [startGroupsParameters, ...pathsGroupsParameters]
  };
  log.debug("paths parameters", pathsParams);
  data.dValues = morphingLayer(morphingParams, pathsParams).dValues;
  return data;
};

const phasesLayer = (parameters: InputParameters = defaultParameters): Data =>
  pipe(
    setParameters(parameters),
    generateOuterPaths,
    calcProgressions,
    generateGroupsParameters,
    generateDValues
  );

export default phasesLayer;
