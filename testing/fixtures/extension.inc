#!/bin/sh

source ./issue101.sh

RED=`tput setaf 1`
GREEN=`tput setaf 2`
BLUE=`tput setaf 4`
BOLD=`tput bold`
RESET=`tput sgr0`

extensionFunc() {
  LOCAL_VARIABLE='local'

  innerExtensionFunc() {
    echo $LOCAL_VARIABLE
  }
}