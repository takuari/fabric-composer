import {Component, OnInit} from '@angular/core';
import {NgbActiveModal} from '@ng-bootstrap/ng-bootstrap';

import {AdminService} from '../admin.service';
import {ClientService} from '../client.service';
import {SampleBusinessNetworkService} from '../services/samplebusinessnetwork.service';
import {AlertService} from '../services/alert.service';

const fabricComposerOwner = 'fabric-composer';
const fabricComposerRepository = 'sample-networks';

@Component({
  selector: 'sample-model',
  templateUrl: './import.component.html',
  styleUrls: ['./import.component.scss'.toString()]
})
export class ImportComponent implements OnInit {

  private deployInProgress: boolean = false;
  private gitHubInProgress: boolean = false;
  private sampleNetworks = [];
  private owner: string = '';
  private repository: string = '';
  private gitHubAuthenticated: boolean = false;
  private oAuthEnabled: boolean = false;
  private clientId: string = null;
  private chosenNetwork = null;
  private expandInput: boolean = false;

  private maxFileSize: number = 5242880;
  private supportedFileTypes: string[] = ['.bna'];

  private currentBusinessNetwork = null;

  constructor(private adminService: AdminService,
              private clientService: ClientService,
              public activeModal: NgbActiveModal,
              private sampleBusinessNetworkService: SampleBusinessNetworkService,
              private alertService: AlertService) {

  }

  ngOnInit(): Promise<any> {
    // TODO: try and do this when we close modal
    this.currentBusinessNetwork = null;

    return this.adminService.ensureConnected()
      .then(() => {
        return this.clientService.ensureConnected();
      })
      .then(() => {
        return this.sampleBusinessNetworkService.isOAuthEnabled()
      })
      .then((result) => {
        this.oAuthEnabled = result;
        if (result) {
          return this.sampleBusinessNetworkService.getGithubClientId()
            .then((clientId) => {
              if (!clientId) {
                // shouldn't get here as oauthEnabled should return false
                // if client id not set but just incase
                return this.activeModal.dismiss(
                  new Error(this.sampleBusinessNetworkService.NO_CLIENT_ID)
                );
              }

              this.clientId = clientId;
              this.onShow();
            })
        } else {
          this.onShow();
        }
      });

  }

  private onShow() {
    this.gitHubInProgress = true;
    this.gitHubAuthenticated = this.sampleBusinessNetworkService.isAuthenticatedWithGitHub();
    if (this.gitHubAuthenticated) {
      return this.sampleBusinessNetworkService.getModelsInfo(fabricComposerOwner,
                                                             fabricComposerRepository)
        .then((modelsInfo) => {
          this.sampleNetworks = modelsInfo;
          this.gitHubInProgress = false;
        })
        .catch((error) => {
          if (error.message.includes('API rate limit exceeded')) {
            error = new Error(this.sampleBusinessNetworkService.RATE_LIMIT_MESSAGE);
          }

          this.activeModal.dismiss(error);
        });
    }
  }

  private fileDetected(count) {
    this.expandInput = true;
  }


  private fileLeft(count) {
    if (count === 0) {
      this.expandInput = false;
    }
  }

  private fileAccepted(file: File) {
    let fileReader = new FileReader();
    fileReader.onload = () => {
      let dataBuffer = Buffer.from(fileReader.result);
      this.sampleBusinessNetworkService.getBusinessNetworkFromArchive(dataBuffer)
        .then((businessNetwork) => {
          this.currentBusinessNetwork = businessNetwork;
          // needed for if browse file
          this.expandInput = true;
        });
    };

    fileReader.readAsArrayBuffer(file);
  }

  private fileRejected(reason: string) {
    this.alertService.errorStatus$.next(reason);
  }

  private removeFile() {
    this.expandInput = false;
    this.currentBusinessNetwork = null;
  }

  private deploy() {
    this.deployInProgress = true;
    let deployPromise;

    if (this.currentBusinessNetwork) {
      deployPromise = this.sampleBusinessNetworkService.deployBusinessNetwork(this.currentBusinessNetwork)
    } else {
      deployPromise = this.deployFromGitHub();
    }

    deployPromise.then(() => {
      this.deployInProgress = false;
      this.activeModal.close();
    })
      .catch((error) => {
        if (error.message.includes('API rate limit exceeded')) {
          error = new Error(this.sampleBusinessNetworkService.RATE_LIMIT_MESSAGE);
        }

        this.deployInProgress = false;
        this.activeModal.dismiss(error);
      });


    return deployPromise;
  }


  private deployFromGitHub(): Promise < any > {
    let chosenSampleNetwork = this.sampleNetworks.find((sampleNetwork) => {
      return sampleNetwork.name === this.chosenNetwork;
    });

    let chosenOwner = this.owner !== '' ? this.owner : fabricComposerOwner;
    let chosenRepository = this.repository !== '' ? this.repository : fabricComposerRepository;
    return this.sampleBusinessNetworkService.deploySample(chosenOwner, chosenRepository, chosenSampleNetwork)
  }
}
